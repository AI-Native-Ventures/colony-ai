import { createHash, randomUUID } from "node:crypto";
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

export function downloadFileName(name) {
  const base = String(name)
    .replace(/\\/gu, "/")
    .split("/")
    .at(-1)
    ?.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 120);
  const safe = base || "download";
  const extension = path.extname(safe).slice(0, 20);
  const stem = safe.slice(0, safe.length - extension.length) || "download";
  return `${stem}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
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
