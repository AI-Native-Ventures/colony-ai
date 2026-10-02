import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(siteRoot, "dist");
const mime = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"], [".png", "image/png"], [".svg", "image/svg+xml"],
  [".webp", "image/webp"], [".woff2", "font/woff2"],
]);

const server = createServer(async (request, response) => {
  if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("invalid path");
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(target);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": body.length,
      "Content-Type": mime.get(path.extname(target).toLowerCase()) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found\n");
  }
});

server.listen(5196, "127.0.0.1", () => {
  console.log("Serving site/dist at http://127.0.0.1:5196/");
});
