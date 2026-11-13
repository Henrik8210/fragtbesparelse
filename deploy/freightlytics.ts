import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const IMAGE_KEY = "container-image";
const SECRET_KEY = "admin-secret-fingerprint";
const TOKEN_KEY = "admin-sync-token";
const ADMIN_SYNC_PATH = "/api/internal/admin-password";

type Env = {
  APP: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
  DATABASE_URL?: string;
  FRAGTBLIK_ADMIN_PASSWORD?: string;
};

type StartConfig = {
  adminPassword: string;
  databaseUrl: string;
};

export class FreightlyticsContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;
  private monitorGeneration = 0;
  private syncedFingerprint = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (isAdminSyncPath(url.pathname)) return new Response("not found", { status: 404 });
    const config = readStartConfig(this.env, request);
    this.starting ??= this.startAndWait(config).finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    const container = this.ctx.container;
    if (!container) return new Response("container missing", { status: 503 });
    return container.getTcpPort(PORT).fetch(forwardToContainer(request, config.adminPassword));
  }

  private async startAndWait(config: StartConfig): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("container missing");
    const image = container.images.base;
    const secret = config.adminPassword;
    const fingerprint = secret ? await fingerprintOf(secret) : "";
    await this.replaceStaleContainer(container, image, fingerprint);
    if (!container.running) {
      this.syncedFingerprint = "";
      const token = newSyncToken();
      await this.ctx.storage.put(TOKEN_KEY, token);
      const env: Record<string, string> = {
        HOST: "0.0.0.0",
        PORT: String(PORT),
        FRAGTBLIK_SYNC_TOKEN: token,
      };
      if (config.databaseUrl) env.DATABASE_URL = config.databaseUrl;
      if (fingerprint) env.FRAGTBLIK_ADMIN_PASSWORD = secret;
      container.start({
        image,
        instance: "standard-1",
        enableInternet: true,
        env,
      });
      await this.ctx.storage.put(IMAGE_KEY, image);
      if (fingerprint) await this.ctx.storage.put(SECRET_KEY, fingerprint);
    }
    this.observeExit();
    try {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch {
      // A rejected timeout must not turn the page request into a Worker exception.
    }

    const port = container.getTcpPort(PORT);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        await response.text();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // The process is still starting.
      }
      await scheduler.wait(500);
    }
    if (!ready) throw new Error("Freightlytics did not become ready");
    if (fingerprint) await this.pushAdminPassword(port, secret, fingerprint);
  }

  private async pushAdminPassword(
    port: { fetch(input: string, init?: RequestInit): Promise<Response> },
    secret: string,
    fingerprint: string,
  ): Promise<void> {
    if (this.syncedFingerprint === fingerprint) return;
    const token = (await this.ctx.storage.get<string>(TOKEN_KEY)) ?? "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["x-fragtblik-sync"] = token;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await port.fetch("http://container/api/internal/admin-password", {
          method: "POST",
          headers,
          body: JSON.stringify({ password: secret }),
          signal: AbortSignal.timeout(20000),
        });
        await response.text();
        if (response.status === 200) {
          this.syncedFingerprint = fingerprint;
          return;
        }
      } catch {
        // The health check can leave the container connection unusable. Try again.
      }
      await scheduler.wait(200);
    }
  }

  private async replaceStaleContainer(
    container: NonNullable<DurableObjectState["container"]>,
    image: string,
    fingerprint: string,
  ): Promise<void> {
    if (!container.running) return;
    const handle = container as unknown as {
      inspect(): Promise<{ image: string } | null>;
      destroy(): Promise<void>;
    };
    let runningImage = "";
    try {
      const info = await handle.inspect();
      runningImage = info?.image ?? "";
    } catch {
      runningImage = "";
    }
    const imageStale = runningImage === image
      ? false
      : runningImage !== "" || (await this.ctx.storage.get<string>(IMAGE_KEY)) !== image;
    const secretStale = fingerprint !== "" && (await this.ctx.storage.get<string>(SECRET_KEY)) !== fingerprint;
    if (!imageStale && !secretStale) {
      if (runningImage === image) await this.ctx.storage.put(IMAGE_KEY, image);
      return;
    }
    this.monitorGeneration += 1;
    this.monitoring = undefined;
    this.syncedFingerprint = "";
    await handle.destroy();
  }

  private observeExit(): void {
    if (this.monitoring || !this.ctx.container) return;
    const generation = ++this.monitorGeneration;
    try {
      this.monitoring = this.ctx.container
        .monitor()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          if (this.monitorGeneration === generation) this.monitoring = undefined;
        });
      this.ctx.waitUntil(this.monitoring);
    } catch {
      this.monitoring = undefined;
    }
  }
}

function readStartConfig(env: Env, request: Request): StartConfig {
  const adminFromEnv = (env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
  const adminFromHeader = (request.headers.get("x-fragtblik-admin-secret") ?? "").trim();
  const adminPassword = usablePassword(adminFromEnv)
    ? adminFromEnv
    : usablePassword(adminFromHeader)
      ? adminFromHeader
      : "";
  const databaseFromEnv = (env.DATABASE_URL ?? "").trim();
  const databaseFromHeader = (request.headers.get("x-fragtblik-database-url") ?? "").trim();
  return {
    adminPassword,
    databaseUrl: databaseFromEnv || (headerSafe(databaseFromHeader) ? databaseFromHeader : ""),
  };
}

function usablePassword(value: string): boolean {
  return value.length >= 8 && value.length <= 80;
}

function headerSafe(value: string): boolean {
  return value.length > 0 && value.length < 4096 && !/[\u0000-\u001f\u007f]/.test(value);
}

function newSyncToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprintOf(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAdminSyncPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return path === ADMIN_SYNC_PATH;
}

function forwardToContainer(request: Request, secret: string): Request {
  const url = new URL(request.url);
  const publicHost = url.host;
  const path = url.pathname.replace(/\/$/, "") || "/";
  url.protocol = "http:";
  url.host = "container";
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (name === "host" || name === "x-fragtblik-admin-secret" || name === "x-fragtblik-database-url" || name === "x-fragtblik-sync") continue;
    headers.append(name, value);
  }
  if ((path === "/api/me" || path === "/api/login") && usablePassword(secret) && headerSafe(secret)) {
    headers.set("x-fragtblik-admin-secret", secret);
  }
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", publicHost);
  const client = request.headers.get("cf-connecting-ip");
  if (client) headers.set("x-forwarded-for", client);
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, { method, headers, body: hasBody ? request.body : undefined, redirect: "manual" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isAdminSyncPath(url.pathname)) return new Response("not found", { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete("x-fragtblik-admin-secret");
    headers.delete("x-fragtblik-database-url");
    const secret = (env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
    if (usablePassword(secret)) headers.set("x-fragtblik-admin-secret", secret);
    const databaseUrl = (env.DATABASE_URL ?? "").trim();
    if (headerSafe(databaseUrl)) headers.set("x-fragtblik-database-url", databaseUrl);
    return env.APP.getByName("freightlytics").fetch(new Request(request, { headers }));
  },
};
