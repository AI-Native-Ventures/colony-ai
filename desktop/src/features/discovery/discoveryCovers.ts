export const DISCOVERY_COVERS_BASE_URL =
  "https://colony.global/discovery/covers/v1";

export type DiscoveryCoverSize = 640 | 1200;

export function discoveryCoverUrl(
  id: string | null | undefined,
  size: DiscoveryCoverSize,
): string | null {
  const safeId = id?.trim();
  if (!safeId || !/^[a-z0-9-]+$/.test(safeId)) return null;
  return `${DISCOVERY_COVERS_BASE_URL}/${safeId}-${String(size)}.webp`;
}

export function shouldShowDiscoveryCover(
  id: string | null | undefined,
  size: DiscoveryCoverSize,
  failedUrl: string | null,
): boolean {
  const url = discoveryCoverUrl(id, size);
  return Boolean(url && failedUrl !== url);
}
