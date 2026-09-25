import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(siteRoot, "dist");
const runner = path.join(siteRoot, "tests", "demo-runner.html");
const mime = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"], [".png", "image/png"], [".svg", "image/svg+xml"],
  [".webp", "image/webp"], [".woff2", "font/woff2"], [".xml", "application/xml; charset=utf-8"],
]);

createServer(async (request, response) => {
  if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const target = pathname === "/__qa/" || pathname === "/__qa/demo-runner.html"
      ? runner
      : path.resolve(dist, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    if (target !== runner && !target.startsWith(`${dist}${path.sep}`)) throw new Error("invalid path");
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
}).listen(5198, "127.0.0.1", () => {
  console.log("Serving dist at http://127.0.0.1:5198/ and the private QA harness at /__qa/");
});
