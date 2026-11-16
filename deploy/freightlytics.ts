import { DurableObject } from "cloudflare:workers";
import { REVISION, healthMatchesRevision } from "./revision.ts";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const IMAGE_KEY = "container-image";
const SECRET_KEY = "admin-secret-fingerprint";
const TOKEN_KEY = "admin-sync-token";
const ADMIN_SYNC_PATH = "/api/internal/admin-password";
const INVOICE_MAIL_PATH = "/api/internal/invoice-mail";

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
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === INVOICE_MAIL_PATH) {
      if (request.headers.get("x-fragtblik-mail-ingress") !== "1") return new Response("not found", { status: 404 });
      return this.receiveMail(request);
    }
    if (isClosedPath(path)) return new Response("not found", { status: 404 });
    const config = readStartConfig(this.env, request);
    this.starting ??= this.startAndWait(config).finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    const container = this.ctx.container;
    if (!container) return new Response("container missing", { status: 503 });
    return container.getTcpPort(PORT).fetch(await forwardToContainer(request, config.adminPassword));
  }

  private async startAndWait(config: StartConfig): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("container missing");
    const image = container.images.base;
    const secret = config.adminPassword;
    const fingerprint = secret ? await fingerprintOf(secret) : "";
    await this.replaceStaleContainer(container, image, fingerprint);
    if (!container.running) await this.boot(container, image, fingerprint, config);
    const probed = await this.probeHealth(container);
    // A running process can still be the previous page when its image name matches.
    if (probed !== null && !healthMatchesRevision(probed)) {
      await this.forceRestart(container, image, fingerprint, config);
    }
    const body = await this.waitForRevision(container);
    if (!healthMatchesRevision(body)) throw new Error("Freightlytics did not become ready");
    if (fingerprint) await this.pushAdminPassword(container.getTcpPort(PORT), secret, fingerprint);
  }

  private async boot(
    container: NonNullable<DurableObjectState["container"]>,
    image: string,
    fingerprint: string,
    config: StartConfig,
  ): Promise<void> {
    this.syncedFingerprint = "";
    const token = newSyncToken();
    await this.ctx.storage.put(TOKEN_KEY, token);
    const env: Record<string, string> = {
      HOST: "0.0.0.0",
      PORT: String(PORT),
      FRAGTBLIK_SYNC_TOKEN: token,
    };
    if (config.databaseUrl) env.DATABASE_URL = config.databaseUrl;
    if (fingerprint) env.FRAGTBLIK_ADMIN_PASSWORD = config.adminPassword;
    container.start({
      image,
      instance: "standard-1",
      enableInternet: true,
      env,
    });
    await this.ctx.storage.put(IMAGE_KEY, image);
    if (fingerprint) await this.ctx.storage.put(SECRET_KEY, fingerprint);
    this.observeExit();
    try {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch {
      // A rejected timeout must not turn the page request into a Worker exception.
    }
  }

  private async probeHealth(container: NonNullable<DurableObjectState["container"]>): Promise<string | null> {
    try {
      const response = await container.getTcpPort(PORT).fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
      const body = await response.text();
      return response.ok ? body : null;
    } catch {
      return null;
    }
  }

  private async waitForRevision(container: NonNullable<DurableObjectState["container"]>): Promise<string> {
    const port = container.getTcpPort(PORT);
    let last = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        const body = await response.text();
        if (response.ok && healthMatchesRevision(body)) return body;
        if (response.ok) last = body;
      } catch {
        // The process is still starting.
      }
      await scheduler.wait(500);
    }
    return last;
  }

  private async forceRestart(
    container: NonNullable<DurableObjectState["container"]>,
    image: string,
    fingerprint: string,
    config: StartConfig,
  ): Promise<void> {
    if (container.running) {
      this.monitorGeneration += 1;
      this.monitoring = undefined;
      this.syncedFingerprint = "";
      const handle = container as unknown as { destroy(): Promise<void> };
      await handle.destroy();
    }
    if (!container.running) await this.boot(container, image, fingerprint, config);
  }

  private async receiveMail(request: Request): Promise<Response> {
    const config = readStartConfig(this.env, request);
    this.starting ??= this.startAndWait(config).finally(() => {
      this.starting = undefined;
    });
    try {
      await this.starting;
    } catch {
      return new Response("not ready", { status: 503 });
    }
    const container = this.ctx.container;
    if (!container) return new Response("container missing", { status: 503 });
    const token = (await this.ctx.storage.get<string>(TOKEN_KEY)) ?? "";
    if (!token) return new Response("not ready", { status: 503 });
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const headers = new Headers();
    headers.set("content-type", "message/rfc822");
    headers.set("x-fragtblik-sync", token);
    const recipient = request.headers.get("x-fragtblik-mail-to") ?? "";
    const sender = request.headers.get("x-fragtblik-mail-from") ?? "";
    if (recipient) headers.set("x-fragtblik-mail-to", recipient);
    if (sender) headers.set("x-fragtblik-mail-from", sender);
    let body: ArrayBuffer;
    try {
      body = await request.arrayBuffer();
    } catch {
      return new Response("not ready", { status: 503 });
    }
    try {
      return await container.getTcpPort(PORT).fetch(new Request(url, { method: "POST", headers, body }));
    } catch {
      return new Response("not ready", { status: 503 });
    }
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

function headerPlain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]/g, "").trim().slice(0, 320);
}

async function acceptRoutedMail(message: InboundMail, env: Env): Promise<void> {
  const to = headerPlain(message?.to);
  const from = headerPlain(message?.from);
  if (!to.toLowerCase().endsWith("@freightlytics.io")) {
    safeReject(message, "Ukendt modtager");
    return;
  }
  const size = typeof message?.rawSize === "number" ? message.rawSize : 0;
  if (size > 8_000_000) {
    safeReject(message, "Vedhæftningen er for stor");
    return;
  }
  const raw = await readRawMail(message?.raw);
  if (raw === "large") {
    safeReject(message, "Vedhæftningen er for stor");
    return;
  }
  if (raw.byteLength === 0 && size > 0) return;
  let status = await postInvoice(env, to, from, raw);
  if (status !== 200 && status !== 404 && status !== 413) status = await postInvoice(env, to, from, raw);
  if (status === 200) return;
  if (status === 413) safeReject(message, "Vedhæftningen er for stor");
  else if (status === 404) safeReject(message, "Ukendt modtager");
}

async function postInvoice(env: Env, to: string, from: string, raw: Uint8Array): Promise<number> {
  try {
    const headers = new Headers();
    headers.set("content-type", "message/rfc822");
    headers.set("x-fragtblik-mail-ingress", "1");
    if (to) headers.set("x-fragtblik-mail-to", to);
    if (from) headers.set("x-fragtblik-mail-from", from);
    const secret = typeof env?.FRAGTBLIK_ADMIN_PASSWORD === "string" ? env.FRAGTBLIK_ADMIN_PASSWORD.trim() : "";
    if (usablePassword(secret)) headers.set("x-fragtblik-admin-secret", secret);
    const databaseUrl = typeof env?.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
    if (headerSafe(databaseUrl)) headers.set("x-fragtblik-database-url", databaseUrl);
    const response = await env.APP.getByName("freightlytics").fetch(new Request("https://freightlytics.io/api/internal/invoice-mail", {
      method: "POST",
      headers,
      body: raw,
    }));
    const status = response.status;
    try {
      await response.arrayBuffer();
    } catch {
      // The response body is optional. A 200 means the row is stored.
    }
    return status;
  } catch {
    return 0;
  }
}

function safeReject(message: InboundMail, reason: string): void {
  try {
    message?.setReject?.(reason);
  } catch {
    // The reject reason is optional.
  }
}

async function readRawMail(raw: ReadableStream | undefined): Promise<Uint8Array | "large"> {
  try {
    if (!raw || typeof raw.getReader !== "function") return new Uint8Array();
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = chunkBytes(step.value);
      size += chunk.byteLength;
      if (size > 8_000_000) {
        await reader.cancel().catch(() => undefined);
        return "large";
      }
      chunks.push(chunk);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } catch {
    return new Uint8Array();
  }
}

function chunkBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
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

function isClosedPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return path === ADMIN_SYNC_PATH || path === INVOICE_MAIL_PATH;
}

async function forwardToContainer(request: Request, secret: string): Promise<Request> {
  const url = new URL(request.url);
  const publicHost = url.host;
  const path = url.pathname.replace(/\/$/, "") || "/";
  url.protocol = "http:";
  url.host = "container";
  const method = request.method;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-fragtblik-admin-secret");
  headers.delete("x-fragtblik-database-url");
  headers.delete("x-fragtblik-sync");
  const carrySecret = (path === "/api/me" || path === "/api/login") && usablePassword(secret) && headerSafe(secret);
  let body: ArrayBuffer | string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const raw = await request.arrayBuffer();
    if (path === "/api/login" && carrySecret) {
      let parsed: Record<string, unknown> = {};
      try {
        const value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      parsed.adminSecret = secret;
      body = JSON.stringify(parsed);
      headers.set("content-type", "application/json");
    } else {
      body = raw;
    }
  }
  if (carrySecret) headers.set("x-fragtblik-admin-secret", secret);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", publicHost);
  const client = request.headers.get("cf-connecting-ip");
  if (client) headers.set("x-forwarded-for", client);
  return new Request(url, { method, headers, body, redirect: "manual" });
}

type InboundMail = {
  from?: unknown;
  to?: unknown;
  raw?: ReadableStream;
  rawSize?: number;
  setReject?(reason: string): void;
};

export default {
  async email(message: InboundMail, env: Env): Promise<void> {
    try {
      await acceptRoutedMail(message, env);
    } catch {
      // A missing optional field must not escape the worker. Cloudflare treats that as a failed delivery.
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isClosedPath(url.pathname)) return new Response("not found", { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("x-fragtblik-admin-secret");
    headers.delete("x-fragtblik-database-url");
    headers.delete("x-fragtblik-mail-ingress");
    const secret = (env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
    if (usablePassword(secret)) headers.set("x-fragtblik-admin-secret", secret);
    const databaseUrl = (env.DATABASE_URL ?? "").trim();
    if (headerSafe(databaseUrl)) headers.set("x-fragtblik-database-url", databaseUrl);
    const method = request.method;
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    return env.APP.getByName("freightlytics").fetch(new Request(request.url, { method, headers, body, redirect: "manual" }));
  },
};
