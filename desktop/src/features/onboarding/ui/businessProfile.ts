export function websiteFaviconUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
    );
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return `${url.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

export function resolveBusinessLogoUrl({
  uploadedLogo,
  faviconUrl,
  faviconFailed,
}: {
  uploadedLogo: string | null;
  faviconUrl: string | null;
  faviconFailed: boolean;
}): string | null {
  return uploadedLogo ?? (!faviconFailed ? faviconUrl : null);
}
