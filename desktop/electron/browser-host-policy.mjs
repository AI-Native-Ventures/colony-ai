import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_BROWSER_TABS = 12;
export const MAX_BROWSER_PROFILES = 32;
export const MAX_ACTIVE_BROWSER_DOWNLOADS = 4;
export const MAX_BROWSER_DOWNLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_BROWSER_BOUNDS = 8_192;
export const MAX_BROWSER_URL_LENGTH = 8_192;
export const MAX_BROWSER_TITLE_LENGTH = 512;
export const MAX_BROWSER_ERROR_LENGTH = 512;

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function checkedScopeId(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    value.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(`Invalid browser ${label}`);
  }
  return value;
}

export function checkedUrl(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BROWSER_URL_LENGTH
  ) {
    throw new Error("Invalid browser URL");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid browser URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("Only credential-free HTTP and HTTPS pages are allowed");
  }
  return url.href;
}

export function isAllowedWebUrl(value) {
  try {
    checkedUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function isAllowedFrameUrl(value, isMainFrame) {
  if (isAllowedWebUrl(value)) return true;
  if (isMainFrame) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "about:" && url.pathname === "blank") ||
      url.protocol === "blob:" ||
      url.protocol === "data:"
    );
  } catch {
    return false;
  }
}

export function checkedBounds(value, window) {
  if (!isRecord(value)) throw new Error("Invalid browser bounds");
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isFinite))
    throw new Error("Invalid browser bounds");
  const bounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
  const content = window.getContentBounds();
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width < 1 ||
    bounds.height < 1 ||
    bounds.width > MAX_BROWSER_BOUNDS ||
    bounds.height > MAX_BROWSER_BOUNDS ||
    bounds.x + bounds.width > content.width ||
    bounds.y + bounds.height > content.height
  ) {
    throw new Error("Browser bounds must fit within the app window");
  }
  return bounds;
}

/**
 * A file name that is safe to create in the user's Downloads folder: a bare
 * name (no directories, no leading dots, no control or reserved characters)
 * with the stem and extension bounded. Uniqueness is the caller's job, so the
 * person sees `report.pdf`, not a machine-made suffix.
 */
export function safeDownloadName(name) {
  const base = String(name)
    .replace(/\\/gu, "/")
    .split("/")
    .at(-1)
    ?.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 120);
  const safe = base || "download";
  const extension = path.extname(safe).slice(0, 20);
  const stem = safe.slice(0, safe.length - extension.length) || "download";
  return `${stem}${extension}`;
}

/** The nth collision-free spelling of a download name: `report (2).pdf`. */
export function numberedDownloadName(name, attempt) {
  if (attempt <= 0) return name;
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  return `${stem} (${attempt})${extension}`;
}

export function navigationFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/ERR_[A-Z0-9_]+/u)?.[0];
  return (code ? `Navigation failed (${code})` : "Navigation failed").slice(
    0,
    MAX_BROWSER_ERROR_LENGTH,
  );
}

export function browserPartition(businessId, clientId) {
  const scope = JSON.stringify([businessId, clientId]);
  const digest = createHash("sha256").update(scope).digest("hex").slice(0, 40);
  return `persist:colony-browser-${digest}`;
}

export function browserProfileIdentity(businessId, clientId) {
  const partition = browserPartition(businessId, clientId);
  const profileHash = partition.slice("persist:colony-browser-".length);
  const businessHash = browserPartition(businessId, null).slice(
    "persist:colony-browser-".length,
  );
  return { partition, profileHash, businessHash };
}

/**
 * Keyboard shortcuts that must keep working while the page has focus, because
 * a native page view swallows key events before the app window sees them.
 * Returns the action to relay to the app window, or null to leave the key to
 * the page. `platform` follows `process.platform`.
 */
export function browserShortcutAction(input, platform) {
  if (!isRecord(input) || input.type !== "keyDown" || input.isAutoRepeat)
    return null;
  const mac = platform === "darwin";
  const primary = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  if (other) return null;
  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
  if (primary && !input.alt) {
    if (input.shift) return null;
    switch (key) {
      case "l":
        return "focus-address";
      case "t":
        return "new-tab";
      case "w":
        return "close-tab";
      case "r":
        return "reload";
      case "[":
        return "back";
      case "]":
        return "forward";
      case "\\":
        return "toggle-dock";
      default:
        return null;
    }
  }
  // Option+Arrow is word movement in a macOS text field, so Alt history keys
  // are for Windows and Linux only; macOS uses Command+[ and Command+].
  if (!mac && !primary && input.alt && !input.shift) {
    if (key === "arrowleft") return "back";
    if (key === "arrowright") return "forward";
  }
  if (!primary && !input.alt && !input.shift && key === "f5") return "reload";
  return null;
}
