declare const __COLONY_LOGO_DEV_TOKEN__: string;

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
    return domain.includes(".") ? domain : null;
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

export function shouldShowBusinessLogo(
  website: string | null | undefined,
  token: string | null | undefined,
  imageFailed: boolean,
): boolean {
  return !imageFailed && businessLogoUrl(website, token) !== null;
}

export function buildTimeLogoToken(): string {
  return typeof __COLONY_LOGO_DEV_TOKEN__ === "string"
    ? __COLONY_LOGO_DEV_TOKEN__
    : "";
}
