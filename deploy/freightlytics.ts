import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const IMAGE_KEY = "container-image";

type Env = {
  APP: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
  DATABASE_URL?: string;
  FRAGTBLIK_ADMIN_PASSWORD?: string;
};

export class FreightlyticsContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;
  private monitorGeneration = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWait().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    const container = this.ctx.container;
    if (!container) return new Response("container missing", { status: 503 });
    return container.getTcpPort(PORT).fetch(forwardToContainer(request));
  }

  private async startAndWait(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("container missing");
    const image = container.images.base;
    await this.replaceStaleContainer(container, image);
    if (!container.running) {
      const env: Record<string, string> = { HOST: "0.0.0.0", PORT: String(PORT) };
      if (this.env.DATABASE_URL) env.DATABASE_URL = this.env.DATABASE_URL;
      if (this.env.FRAGTBLIK_ADMIN_PASSWORD) env.FRAGTBLIK_ADMIN_PASSWORD = this.env.FRAGTBLIK_ADMIN_PASSWORD;
      container.start({
        image,
        instance: "standard-1",
        enableInternet: true,
        env,
      });
      await this.ctx.storage.put(IMAGE_KEY, image);
    }
    this.observeExit();
    try {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch {
      // A rejected timeout must not turn the page request into a Worker exception.
    }

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // The process is still starting.
      }
      await scheduler.wait(500);
    }
    throw new Error("Freightlytics did not become ready");
  }

  private async replaceStaleContainer(
    container: NonNullable<DurableObjectState["container"]>,
    image: string,
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
    if (runningImage === image) {
      await this.ctx.storage.put(IMAGE_KEY, image);
      return;
    }
    if (runningImage === "") {
      const started = await this.ctx.storage.get<string>(IMAGE_KEY);
      if (started === image) return;
    }
    this.monitorGeneration += 1;
    this.monitoring = undefined;
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

function forwardToContainer(request: Request): Request {
  const url = new URL(request.url);
  const publicHost = url.host;
  url.protocol = "http:";
  url.host = "container";
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (name === "host") continue;
    headers.append(name, value);
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
    return env.APP.getByName("freightlytics").fetch(request);
  },
};
