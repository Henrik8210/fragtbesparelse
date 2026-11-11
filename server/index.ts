import { createServer } from "node:http";
import { createServer as createVite } from "vite";
import { handleApi } from "./api.ts";

const port = 5173;
const vite = await createVite({
  server: { middlewareMode: true, host: "127.0.0.1", port },
  appType: "spa",
});

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    void handleApi(req, res);
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fragtblik listening on http://127.0.0.1:${port}`);
});
