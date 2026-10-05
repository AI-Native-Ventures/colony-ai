import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

export const webRoot = fileURLToPath(new URL("../../", import.meta.url));
export const srcRoot = path.join(webRoot, "src");

/**
 * A Vite dev server in middleware mode, used only to load the real web source
 * (TSX, the `@` alias, asset imports) into Node. Nothing is bundled or served.
 */
export async function startSourceLoader() {
  const server = await createServer({
    root: webRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    plugins: [react()],
    resolve: { alias: { "@": "/src" } },
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return {
    load: (modulePath) => server.ssrLoadModule(modulePath),
    close: () => server.close(),
  };
}

/** Pretend to be a browser on the given origin for code that reads `window`. */
export function installBrowserGlobals(origin) {
  const url = new URL(origin);
  globalThis.window = {
    location: {
      protocol: url.protocol,
      host: url.host,
      origin: url.origin,
      href: url.href,
    },
  };
}

/** Text a visitor can read: tags dropped, entities decoded, whitespace folded. */
export function visibleText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that must never reach a visitor of a Colony-served page. */
export const FORBIDDEN_BRAND_PATTERNS = [
  { name: "Buzz", pattern: /buzz/i },
  { name: "bee", pattern: /\bbee\b/i },
  { name: "Fizz", pattern: /\bfizz\b/i },
  { name: "Honey", pattern: /\bhoney\b/i },
  { name: "block/buzz", pattern: /github\.com\/block\//i },
  { name: "apps.apple.com", pattern: /apps\.apple\.com/i },
];
