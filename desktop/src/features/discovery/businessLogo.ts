declare const __COLONY_LOGO_DEV_TOKEN__: string;

const SHARED_OR_LISTING_HOSTS = [
  "apexcom.co.za",
  "airbnb.com",
  "agoda.com",
  "booking.com",
  "bookings.com",
  "facebook.com",
  "google.com",
  "googleusercontent.com",
  "hotels.com",
  "instagram.com",
  "linkedin.com",
  "linktr.ee",
  "linktree.com",
  "myshopify.com",
  "property24.com",
  "sites.google.com",
  "tiktok.com",
  "tripadvisor.com",
  "trivago.com",
  "twitter.com",
  "weebly.com",
  "wixsite.com",
  "wordpress.com",
  "x.com",
  "yellowpages.com",
  "yelp.com",
] as const;

const IPV4_HOST = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const MAX_CACHED_LOGO_SOURCES = 256;
const logoSourceCache = new Map<string, string | null>();

function isSharedOrListingHost(domain: string): boolean {
  return SHARED_OR_LISTING_HOSTS.some(
    (host) => domain === host || domain.endsWith(`.${host}`),
  );
}

function safeStoredImageUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      IPV4_HOST.test(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function extractBusinessDomain(
  website: string | null | undefined,
): string | null {
  const value = website?.trim();
  if (!value) return null;

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const domain = url.hostname
      .toLocaleLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    return domain.includes(".") &&
      !IPV4_HOST.test(domain) &&
      !isSharedOrListingHost(domain)
      ? domain
      : null;
  } catch {
    return null;
  }
}

export function businessLogoUrl(
  website: string | null | undefined,
  token: string | null | undefined,
): string | null {
  const domain = extractBusinessDomain(website);
  const cleanToken = token?.trim();
  if (!domain || !cleanToken) return null;

  const url = new URL(`https://img.logo.dev/${domain}`);
  url.searchParams.set("token", cleanToken);
  url.searchParams.set("size", "64");
  url.searchParams.set("format", "png");
  url.searchParams.set("retina", "true");
  url.searchParams.set("fallback", "404");
  return url.toString();
}

export function resolveBusinessLogoSource(input: {
  website: string | null | undefined;
  logoUrl?: string | null;
  placePhotoUrl?: string | null;
  token: string | null | undefined;
}): string | null {
  const cacheKey = JSON.stringify([
    input.website ?? null,
    input.logoUrl ?? null,
    input.placePhotoUrl ?? null,
    input.token ?? null,
  ]);
  const cached = logoSourceCache.get(cacheKey);
  if (cached !== undefined || logoSourceCache.has(cacheKey)) {
    logoSourceCache.delete(cacheKey);
    logoSourceCache.set(cacheKey, cached ?? null);
    return cached ?? null;
  }

  const source =
    businessLogoUrl(input.website, input.token) ??
    safeStoredImageUrl(input.logoUrl) ??
    safeStoredImageUrl(input.placePhotoUrl);
  logoSourceCache.set(cacheKey, source);
  if (logoSourceCache.size > MAX_CACHED_LOGO_SOURCES) {
    const oldest = logoSourceCache.keys().next().value;
    if (oldest) logoSourceCache.delete(oldest);
  }
  return source;
}

export function shouldShowBusinessLogo(
  source: string | null | undefined,
  imageFailed: boolean,
): boolean {
  return Boolean(source) && !imageFailed;
}

export function buildTimeLogoToken(): string {
  return typeof __COLONY_LOGO_DEV_TOKEN__ === "string"
    ? __COLONY_LOGO_DEV_TOKEN__
    : "";
}
