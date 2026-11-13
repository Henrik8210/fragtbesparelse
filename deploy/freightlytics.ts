import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;

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

    const url = new URL(request.url);
    const publicHost = url.host;
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.set("x-forwarded-proto", "https");
    forwarded.headers.set("x-forwarded-host", publicHost);
    const client = request.headers.get("cf-connecting-ip");
    if (client) forwarded.headers.set("x-forwarded-for", client);
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWait(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("container missing");
    if (!container.running) {
      const env: Record<string, string> = { HOST: "0.0.0.0", PORT: String(PORT) };
      if (this.env.DATABASE_URL) env.DATABASE_URL = this.env.DATABASE_URL;
      if (this.env.FRAGTBLIK_ADMIN_PASSWORD) env.FRAGTBLIK_ADMIN_PASSWORD = this.env.FRAGTBLIK_ADMIN_PASSWORD;
      container.start({
        image: container.images.base,
        instance: "standard-1",
        enableInternet: true,
        env,
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // The process is still starting.
      }
      await scheduler.wait(200);
    }
    throw new Error("Freightlytics did not become ready");
  }

  private observeExit(): void {
    if (this.monitoring || !this.ctx.container) return;
    this.monitoring = this.ctx.container
      .monitor()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.APP.getByName("freightlytics").fetch(request);
  },
};
