import { createServer } from "node:http";
import { createServer as createVite } from "vite";
import { handleApi } from "./api.ts";

const requested = Number(process.env.PORT ?? 5173);
const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 5173;
const host = process.env.HOST ?? "127.0.0.1";
const publicBind = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
const vite = await createVite({
  server: {
    middlewareMode: true,
    host: "127.0.0.1",
    port,
    allowedHosts: publicBind ? true : undefined,
  },
  appType: "spa",
});

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  if (path === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.end("ok");
    return;
  }
  if (url.startsWith("/api/")) {
    void handleApi(req, res);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

server.listen(port, host, () => {
  console.log(`Fragtblik listening on http://${host}:${port}`);
});
