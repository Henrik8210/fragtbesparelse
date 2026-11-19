import { DurableObject } from "cloudflare:workers";
import { headerField, limitMail, MailTooLarge, packMail, readMailBytes } from "./mailBytes.ts";
import { confirmedMail, mailFailure, visibleDatabaseError } from "./mailResult.ts";
import { REVISION, healthMatchesRevision } from "./revision.ts";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const IMAGE_KEY = "container-image";
const SECRET_KEY = "admin-secret-fingerprint";
const TOKEN_KEY = "admin-sync-token";
const ADMIN_SYNC_PATH = "/api/internal/admin-password";
const INVOICE_MAIL_PATH = "/api/internal/invoice-mail";
const EXTRACT_PATH = "/api/invoice-extract";
const EXTRACT_DONE_PATH = "/api/internal/invoice-extract";

type Env = {
  APP: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
  AI?: { run(model: string, inputs: unknown, options?: unknown): Promise<unknown> };
  AI_GATEWAY_ID?: string;
  DATABASE_URL?: string;
  FRAGTBLIK_ADMIN_PASSWORD?: string;
};

type ExtractJob = { id?: unknown; model?: unknown; inputs?: unknown; batches?: unknown };

const AI_CONCURRENCY = 4;
const MAX_BATCHES = 16;

type StartConfig = {
  adminPassword: string;
  databaseUrl: string;
};

const BATCH_TIMEOUT_MS = 150_000;

function aiMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Workers AI svarede ikke.";
  return `Workers AI: ${message}`.slice(0, 200);
}

/** A part that takes longer than `timeoutMs` gives null, which the container reports as a part it could not read. */
async function runInParallel<T>(
  items: T[],
  run: (item: T) => Promise<unknown>,
  concurrency: number,
  timeoutMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<unknown[]> {
  const outputs: unknown[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
      try {
        outputs[index] = await Promise.race([run(items[index]), late]);
      } finally {
        clearTimeout(timer);
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return outputs;
}

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
    const forwarded = await forwardToContainer(request, config.adminPassword);
    if (path === EXTRACT_PATH && request.method === "POST") return passSession(await this.extractInvoice(forwarded));
    const response = await container.getTcpPort(PORT).fetch(forwarded);
    return passSession(response);
  }

  // The container reads the PDF and builds the model request. This object holds the AI binding,
  // runs it, and hands the raw output back to the container, which validates and caches it.
  private async extractInvoice(forwarded: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) return jsonReply(503, { error: "later" });
    const port = container.getTcpPort(PORT);
    const token = (await this.ctx.storage.get<string>(TOKEN_KEY)) ?? "";
    const headers = new Headers(forwarded.headers);
    if (token) headers.set("x-fragtblik-sync", token);
    headers.set("x-fragtblik-ai-bridge", "1");
    const first = await port.fetch(new Request(forwarded, { headers }));
    if (first.status !== 202 || first.headers.get("x-fragtblik-ai-job") !== "1") return first;
    let job: ExtractJob;
    try {
      job = (await first.json()) as ExtractJob;
    } catch {
      return jsonReply(502, { error: "ai", message: "Udtrækket kunne ikke startes." });
    }
    const model = typeof job.model === "string" ? job.model : "";
    if (typeof job.id !== "string" || !model.startsWith("@cf/")) {
      return jsonReply(502, { error: "ai", message: "Udtrækket kunne ikke startes." });
    }
    const ai = this.env.AI;
    if (!ai || typeof ai.run !== "function") {
      return jsonReply(503, { error: "ai-unavailable", message: "Workers AI er ikke slået til på Worker'en, så PDF'ens linjer kan ikke læses. Brug en CSV." });
    }
    const gateway = (this.env.AI_GATEWAY_ID ?? "").trim();
    const options = /^[\w-]{1,64}$/.test(gateway) ? { gateway: { id: gateway } } : undefined;
    // A long price agreement comes as several page groups; an invoice, or an older container, as one `inputs`.
    const batches = Array.isArray(job.batches) && job.batches.length ? job.batches.slice(0, MAX_BATCHES) : [job.inputs];
    const finish = async (outputs: unknown[]): Promise<Response> => {
      const done = await port.fetch(new Request(`http://container${EXTRACT_DONE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-fragtblik-sync": token },
        body: JSON.stringify({ job: job.id, output: outputs[0], outputs }),
      }));
      return new Response(done.body, {
        status: done.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    };
    const runAll = (onProgress?: (done: number, total: number) => void) =>
      runInParallel(batches, (inputs) => ai.run(model, inputs, options), AI_CONCURRENCY, BATCH_TIMEOUT_MS, onProgress);

    if (!/application\/x-ndjson/.test(forwarded.headers.get("accept") ?? "")) {
      try {
        return await finish(await runAll());
      } catch (error) {
        return jsonReply(502, { error: "ai", message: aiMessage(error) });
      }
    }
    // Progress as one JSON line per finished part, then the result line, so a long agreement never looks stuck.
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const line = (value: unknown) => writer.write(encoder.encode(`${JSON.stringify(value)}\n`)).catch(() => undefined);
    const started = Date.now();
    void (async () => {
      const beat = setInterval(() => void line({ progress: { waitingMs: Date.now() - started } }), 15_000);
      try {
        await line({ progress: { done: 0, total: batches.length } });
        const outputs = await runAll((done, total) => void line({ progress: { done, total, elapsedMs: Date.now() - started } }));
        const reply = await finish(outputs);
        const body = await reply.json().catch(() => ({ error: "ai-output", message: "Udtrækket kunne ikke gemmes." }));
        await line({ status: reply.status, body, elapsedMs: Date.now() - started });
      } catch (error) {
        await line({ status: 502, body: { error: "ai", message: aiMessage(error) } });
      } finally {
        clearInterval(beat);
        await writer.close().catch(() => undefined);
      }
    })();
    return new Response(stream.readable, {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
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
    const incomingType = request.headers.get("content-type") ?? "";
    headers.set("content-type", incomingType.includes("json") ? "application/json" : "application/octet-stream");
    headers.set("x-fragtblik-sync", token);
    const recipient = request.headers.get("x-fragtblik-mail-to") ?? "";
    const sender = request.headers.get("x-fragtblik-mail-from") ?? "";
    if (recipient) headers.set("x-fragtblik-mail-to", recipient);
    if (sender) headers.set("x-fragtblik-mail-from", sender);
    let body: ArrayBuffer;
    try {
      body = await request.arrayBuffer();
    } catch {
      return new Response(JSON.stringify({ error: "later" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    const kept = body.slice(0);
    let posted: Response;
    let text = "";
    try {
      posted = await this.postMail(headers, kept.slice(0));
      text = await posted.text();
    } catch {
      return new Response(JSON.stringify({ error: "later" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (posted.status === 200 && text.includes('"postgres":true')) {
      return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (config.databaseUrl && (text.includes('"error":"database"') || text.includes('"postgres":false'))) {
      try {
        const image = container.images.base;
        const fingerprint = config.adminPassword ? await fingerprintOf(config.adminPassword) : "";
        await this.forceRestart(container, image, fingerprint, config);
        await this.waitForRevision(container);
        const nextToken = (await this.ctx.storage.get<string>(TOKEN_KEY)) ?? "";
        if (nextToken) headers.set("x-fragtblik-sync", nextToken);
        return await this.postMail(headers, kept.slice(0));
      } catch {
        return new Response(text || JSON.stringify({ error: "database", message: "invoice mail was not stored" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(text, { status: posted.status, headers: { "content-type": "application/json" } });
  }

  private async postMail(headers: Headers, body: ArrayBuffer): Promise<Response> {
    const container = this.ctx.container;
    if (!container) return new Response(JSON.stringify({ error: "later" }), { status: 503 });
    try {
      return await container.getTcpPort(PORT).fetch(new Request("http://container/api/internal/invoice-mail", {
        method: "POST",
        headers,
        body,
      }));
    } catch {
      return new Response(JSON.stringify({ error: "later" }), { status: 503, headers: { "content-type": "application/json" } });
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
  const companyId = companyFromAddress(to);
  if (!companyId) {
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
  let outcome = await postInvoice(env, to, from, companyId, raw);
  if (outcome !== "stored" && outcome !== "unknown" && outcome !== "large") {
    outcome = await postInvoice(env, to, from, companyId, raw);
  }
  if (outcome === "stored") return;
  if (outcome === "large") {
    safeReject(message, "Vedhæftningen er for stor");
    return;
  }
  if (outcome === "unknown") {
    safeReject(message, "Ukendt modtager");
    return;
  }
  throw new Error(outcome.error);
}

async function postInvoice(env: Env, to: string, from: string, companyId: string, raw: Uint8Array): Promise<"stored" | "unknown" | "large" | { error: string }> {
  try {
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set("x-fragtblik-mail-ingress", "1");
    const recipient = headerField(to);
    const sender = headerField(from);
    if (recipient) headers.set("x-fragtblik-mail-to", recipient);
    if (sender) headers.set("x-fragtblik-mail-from", sender);
    const secret = typeof env?.FRAGTBLIK_ADMIN_PASSWORD === "string" ? env.FRAGTBLIK_ADMIN_PASSWORD.trim() : "";
    if (usablePassword(secret) && headerField(secret) === secret) headers.set("x-fragtblik-admin-secret", secret);
    const databaseUrl = typeof env?.DATABASE_URL === "string" ? env.DATABASE_URL.trim() : "";
    if (headerSafe(databaseUrl) && headerField(databaseUrl) === databaseUrl) headers.set("x-fragtblik-database-url", databaseUrl);
    const response = await env.APP.getByName("freightlytics").fetch(new Request("https://freightlytics.io/api/internal/invoice-mail", {
      method: "POST",
      headers,
      body: packMail(raw),
    }));
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (response.status === 200 && confirmedMail(body, companyId)) return "stored";
    if (response.status === 404) return "unknown";
    if (response.status === 413) return "large";
    return { error: mailFailure(body, response.status) };
  } catch (error) {
    return { error: visibleDatabaseError(error) };
  }
}

function companyFromAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const angled = trimmed.match(/<([^>]+)>\s*$/);
  const email = (angled?.[1] ?? trimmed).trim();
  const at = email.lastIndexOf("@");
  if (at <= 0) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain !== "freightlytics.io" || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(local)) return "";
  return local;
}

function safeReject(message: InboundMail, reason: string): void {
  try {
    message?.setReject?.(reason);
  } catch {
    // The reject reason is optional.
  }
}

async function readRawMail(raw: unknown): Promise<Uint8Array | "large"> {
  try {
    return limitMail(await readMailBytes(raw));
  } catch (error) {
    if (error instanceof MailTooLarge) return "large";
    throw error;
  }
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
  return path === ADMIN_SYNC_PATH || path === INVOICE_MAIL_PATH || path === EXTRACT_DONE_PATH;
}

function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cookieHeader(request: Request): string {
  return request.headers.get("cookie") ?? "";
}

function sessionCookieValues(headers: Headers): string[] {
  const reader = headers as Headers & { getSetCookie?: () => string[]; getAll?: (name: string) => string[] };
  if (typeof reader.getSetCookie === "function") {
    const values = reader.getSetCookie();
    if (values.length > 0) return values;
  }
  if (typeof reader.getAll === "function") {
    try {
      const values = reader.getAll("set-cookie");
      if (values.length > 0) return values;
    } catch {
      // getAll is only valid for Set-Cookie.
    }
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function passSession(response: Response): Response {
  const issued = response.headers.get("x-fragtblik-session");
  const cookies = sessionCookieValues(response.headers);
  if (issued === null && cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  headers.delete("x-fragtblik-session");
  headers.delete("content-length");
  headers.delete("set-cookie");
  for (const cookie of cookies) {
    if (issued !== null && cookie.toLowerCase().startsWith("fragtblik=")) continue;
    headers.append("set-cookie", cookie);
  }
  if (issued !== null) {
    const secure = "; Secure";
    const value = issued === "clear"
      ? `fragtblik=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
      : `fragtblik=${encodeURIComponent(issued)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600${secure}`;
    headers.append("set-cookie", value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function forwardToContainer(request: Request, secret: string): Promise<Request> {
  const url = new URL(request.url);
  const publicHost = url.host;
  const path = url.pathname.replace(/\/$/, "") || "/";
  url.protocol = "http:";
  url.host = "container";
  const method = request.method;
  const headers = new Headers(request.headers);
  const cookie = cookieHeader(request);
  if (cookie) headers.set("cookie", cookie);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-fragtblik-admin-secret");
  headers.delete("x-fragtblik-database-url");
  headers.delete("x-fragtblik-sync");
  headers.delete("x-fragtblik-ai-bridge");
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
    await acceptRoutedMail(message, env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isClosedPath(url.pathname)) return new Response("not found", { status: 404 });
    const headers = new Headers(request.headers);
    const cookie = cookieHeader(request);
    if (cookie) headers.set("cookie", cookie);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("x-fragtblik-admin-secret");
    headers.delete("x-fragtblik-database-url");
    headers.delete("x-fragtblik-mail-ingress");
    headers.delete("x-fragtblik-ai-bridge");
    const secret = (env.FRAGTBLIK_ADMIN_PASSWORD ?? "").trim();
    if (usablePassword(secret)) headers.set("x-fragtblik-admin-secret", secret);
    const databaseUrl = (env.DATABASE_URL ?? "").trim();
    if (headerSafe(databaseUrl)) headers.set("x-fragtblik-database-url", databaseUrl);
    const method = request.method;
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    const response = await env.APP.getByName("freightlytics").fetch(new Request(request.url, { method, headers, body, redirect: "manual" }));
    return passSession(response);
  },
};
