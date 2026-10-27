import {
  extractSupportedLinkPreviews,
  extractSupportedLinkSources,
  parseSupportedLinkPreview,
} from "./linkPreview";
import type { ResolvedLinkPreview } from "./useResolvedLinkPreviews";

export const LINK_PREVIEW_SNAPSHOT_VERSION = "1";
const MAX_SNAPSHOTS = 8;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMAGE_EXT_RE = /^(?:jpg|png|gif|webp)$/;

export function isValidLinkPreviewSnapshotCanonicalUrl(value: string): boolean {
  if (value.includes("#")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

export type LinkPreviewSnapshot = {
  canonicalUrl: string;
  title: string;
  siteName: string;
  description: string;
  imageUrl: string;
  imageSha256: string;
  faviconUrl: string;
  faviconSha256: string;
};

function isControlCharacter(char: string, allowNewlines = false): boolean {
  if (allowNewlines && char === "\n") return false;
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

function sanitizeSnapshotText(
  value: string,
  maxBytes: number,
  allowNewlines = false,
): string {
  let result = "";
  let byteLength = 0;
  for (const rawChar of value) {
    const char = isControlCharacter(rawChar, allowNewlines) ? " " : rawChar;
    const charBytes = new TextEncoder().encode(char).length;
    if (byteLength + charBytes > maxBytes) break;
    result += char;
    byteLength += charBytes;
  }
  return result;
}

function validText(value: string, max: number, allowNewlines = false): boolean {
  return (
    new TextEncoder().encode(value).length <= max &&
    !Array.from(value).some((char) => {
      return isControlCharacter(char, allowNewlines);
    })
  );
}

function isRelayMediaPair(
  url: string,
  sha256: string,
  relayOrigin: string,
): boolean {
  if (!url && !sha256) return true;
  if (!url || !SHA256_RE.test(sha256)) return false;
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== relayOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return false;
    const match = /^\/media\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(
      parsed.pathname,
    );
    return Boolean(
      match && match[1] === sha256 && IMAGE_EXT_RE.test(match[2] ?? ""),
    );
  } catch {
    return false;
  }
}

export function parseLinkPreviewSnapshots(
  tags: readonly (readonly string[])[] | undefined,
  content: string,
  relayOrigin: string | null,
): ResolvedLinkPreview[] {
  if (!relayOrigin || !tags) return [];
  const contentUrls = new Set(
    extractSupportedLinkPreviews(content).map((preview) => preview.href),
  );
  const seen = new Set<string>();
  const snapshots: ResolvedLinkPreview[] = [];
  for (const tag of tags) {
    if (tag[0] !== "link-preview" || tag[1] !== "snapshot") continue;
    if (
      snapshots.length >= MAX_SNAPSHOTS ||
      tag.length !== 11 ||
      tag[2] !== LINK_PREVIEW_SNAPSHOT_VERSION
    )
      continue;
    const [
      ,
      ,
      ,
      canonicalUrl,
      title,
      siteName,
      description,
      imageUrl,
      imageSha256,
      faviconUrl,
      faviconSha256,
    ] = tag;
    // The canonical URL may be the message's own spelling of the link
    // (`https://example.com`) rather than the parser's normal form
    // (`https://example.com/`); compare and dedupe on the normal form.
    const normalizedUrl = normalizeUrl(canonicalUrl);
    const parsed = parseSupportedLinkPreview(canonicalUrl);
    if (
      !parsed ||
      normalizedUrl === null ||
      parsed.href !== normalizedUrl ||
      !contentUrls.has(normalizedUrl) ||
      seen.has(normalizedUrl)
    )
      continue;
    if (
      !validText(title, 300) ||
      !validText(siteName, 100) ||
      !validText(description, 1000, true)
    )
      continue;
    if (
      !isRelayMediaPair(imageUrl, imageSha256, relayOrigin) ||
      !isRelayMediaPair(faviconUrl, faviconSha256, relayOrigin)
    )
      continue;
    seen.add(normalizedUrl);
    snapshots.push({
      ...parsed,
      title: title || parsed.title,
      provider: siteName || parsed.provider,
      description: description || null,
      faviconDataUrl: faviconUrl || null,
      imageDataUrl: imageUrl || null,
      imageDomain: imageUrl ? new URL(imageUrl).hostname : null,
      imageState: imageUrl ? "image" : "none",
    });
  }
  return snapshots;
}

export function buildLinkPreviewSnapshotTag(
  snapshot: LinkPreviewSnapshot,
): string[] | null {
  if (!isValidLinkPreviewSnapshotCanonicalUrl(snapshot.canonicalUrl))
    return null;
  return [
    "link-preview",
    "snapshot",
    LINK_PREVIEW_SNAPSHOT_VERSION,
    snapshot.canonicalUrl,
    sanitizeSnapshotText(snapshot.title, 300),
    sanitizeSnapshotText(snapshot.siteName, 100),
    sanitizeSnapshotText(snapshot.description, 1000, true),
    snapshot.imageUrl,
    snapshot.imageSha256,
    snapshot.faviconUrl,
    snapshot.faviconSha256,
  ];
}

function isSnapshotTag(tag: readonly string[]): boolean {
  return tag[0] === "link-preview" && tag[1] === "snapshot";
}

/**
 * Make every snapshot tag's canonical URL text that appears in `content`.
 *
 * The relay refuses a snapshot whose canonical URL is not a verbatim substring
 * of the message, and a preview href is the URL parser's normal form, which
 * differs from what was typed for a bare origin (`https://example.com` becomes
 * `https://example.com/`), an uppercase host, a default port, non-ASCII text
 * and dot segments. Such a tag is re-pointed at the link as the message spells
 * it. A tag with no URL text in the message to point at (a schemeless
 * `github.com/...` link, or a link edited out after the preview was prepared)
 * is dropped and reported in `dropped`, so the message sends without that
 * preview instead of failing. Suppression markers pass through untouched.
 */
export function alignLinkPreviewTagsWithContent(
  tags: readonly (readonly string[])[],
  content: string,
): { tags: string[][]; dropped: string[] } {
  const aligned: string[][] = [];
  const dropped: string[] = [];
  let sources: Map<string, string> | null = null;
  for (const tag of tags) {
    if (!isSnapshotTag(tag)) {
      aligned.push([...tag]);
      continue;
    }
    const canonicalUrl = tag[3] ?? "";
    if (content.includes(canonicalUrl)) {
      aligned.push([...tag]);
      continue;
    }
    sources ??= extractSupportedLinkSources(content);
    // A fragment is never part of the canonical URL, and the relay refuses one.
    const written = sources.get(canonicalUrl)?.split("#")[0];
    if (
      !written ||
      !content.includes(written) ||
      !isValidLinkPreviewSnapshotCanonicalUrl(written) ||
      normalizeUrl(written) !== canonicalUrl
    ) {
      dropped.push(canonicalUrl);
      continue;
    }
    aligned.push([...tag.slice(0, 3), written, ...tag.slice(4)]);
  }
  return { tags: aligned, dropped };
}
