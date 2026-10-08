/**
 * What the person typed in the address bar, turned into a web address the
 * isolated browser may open, or a plain-language reason it may not.
 *
 * Only credential-free http and https pages open. Everything else (file:,
 * javascript:, data:, blob:, about:, chrome:, mailto: and any other scheme) is
 * refused here with a clear message, and the Electron host refuses it again in
 * `electron/browser-host-policy.mjs` (`checkedUrl`), so this module is a
 * courtesy to the person and never the only gate.
 */

export type BrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

const MAX_ADDRESS_LENGTH = 8_192;
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const ANY_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HOST_AND_PORT = /^[^/?#:\s]+:\d{1,5}(?:[/?#]|$)/;
const LOCAL_HOST =
  /^(localhost|[^./]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|\?|#|$)/i;

const NOT_AN_ADDRESS =
  "That does not look like a web address. Try something like example.com.";
const ONLY_WEB =
  "Colony only opens web pages (http or https), so that address was not opened.";

/** The scheme to name in the refusal, only when it is short and plain. */
function refusedScheme(scheme: string): string {
  return /^[a-z][a-z0-9+.-]{0,19}$/i.test(scheme)
    ? `${scheme.toLowerCase()}:`
    : "";
}

export function normalizeBrowserAddress(raw: string): BrowserAddressResult {
  const input = raw.trim();
  if (input.length === 0)
    return { ok: false, message: "Type a web address to open." };
  if (input.length > MAX_ADDRESS_LENGTH)
    return { ok: false, message: "That address is too long." };
  if (/\s/.test(input)) return { ok: false, message: NOT_AN_ADDRESS };

  const explicit = EXPLICIT_SCHEME.exec(input);
  const anyScheme = ANY_SCHEME.exec(input);
  // "localhost:3000" and "example.com:8080/x" start like a scheme but are a
  // host and port; every other "word:" prefix is a scheme and is refused.
  const hostAndPort = !explicit && HOST_AND_PORT.test(input);
  if (!hostAndPort && anyScheme) {
    const scheme = anyScheme[1].toLowerCase();
    if (!explicit || (scheme !== "http" && scheme !== "https")) {
      const named = refusedScheme(scheme);
      return {
        ok: false,
        message: named ? `${ONLY_WEB} (${named})` : ONLY_WEB,
      };
    }
  }

  const candidate = explicit
    ? input
    : `${LOCAL_HOST.test(input) ? "http" : "https"}://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: NOT_AN_ADDRESS };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, message: ONLY_WEB };
  if (url.username || url.password) {
    return {
      ok: false,
      message:
        "Addresses with a username or password are not supported. Sign in on the page itself.",
    };
  }
  const host = url.hostname;
  const plausibleHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("[") ||
    host.includes(".");
  if (!plausibleHost) return { ok: false, message: NOT_AN_ADDRESS };
  return { ok: true, url: url.href };
}

/** Where the page is, in the form the address bar shows when not editing. */
export function addressBarText(url: string): string {
  return url;
}

/** `https`, `http` or null (a new tab with nothing loaded). */
export function addressProtocol(url: string): "https" | "http" | null {
  if (url.startsWith("https://")) return "https";
  if (url.startsWith("http://")) return "http";
  return null;
}

/** A short tab label: the page title, else the site, else "New tab". */
export function pageLabel(page: { title: string; url: string }): string {
  const title = page.title.trim();
  if (title) return title;
  if (!page.url) return "New tab";
  try {
    return new URL(page.url).hostname || "New tab";
  } catch {
    return "New tab";
  }
}
