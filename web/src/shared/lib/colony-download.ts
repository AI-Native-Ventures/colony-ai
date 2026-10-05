/** Safe default target: the Colony download section lists every desktop file. */
export const COLONY_DOWNLOAD_PAGE_URL = "https://colony.global#download";
export const COLONY_RELEASES_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases";
const COLONY_RELEASES_API_URL =
  "https://api.github.com/repos/AI-Native-Ventures/colony-ai/releases?per_page=30";
/** Desktop releases are tagged `desktop-v<version>`; other tags are not Colony. */
const DESKTOP_TAG_PATTERN = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;
const CACHE_KEY = "colony.latestDownload.v1";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type ColonyDownloadPlatform = {
  operatingSystem:
    | "linux"
    | "macos"
    | "windows"
    | "ios"
    | "android"
    | "unknown";
  architecture: "arm64" | "x64" | "unknown";
};

export type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
};

type UserAgentData = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string; bitness?: string }>;
};

function normalizeOperatingSystem(
  navigatorValue: Navigator,
  userAgentData?: UserAgentData,
): ColonyDownloadPlatform["operatingSystem"] {
  const userAgent = navigatorValue.userAgent.toLowerCase();
  const platform = (
    userAgentData?.platform ??
    navigatorValue.platform ??
    ""
  ).toLowerCase();

  // Compatibility tokens are treacherous: iPadOS can report MacIntel and a
  // Macintosh UA, while Android and ChromeOS expose Linux platform strings.
  // Classify mobile devices before admitting desktop-looking signals.
  const isIPadDesktopMode =
    platform === "macintel" && navigatorValue.maxTouchPoints > 1;
  if (isIPadDesktopMode || /iphone|ipad|ipod/.test(userAgent)) return "ios";
  if (/android/.test(userAgent) || platform === "android") return "android";

  const isUnsupportedDevice =
    userAgentData?.mobile === true ||
    /mobile|tablet|windows phone|iemobile|opera mini|opera mobi|webos|blackberry|bb10|kindle|silk|kaios|cros/.test(
      userAgent,
    );
  if (isUnsupportedDevice) return "unknown";

  if (
    platform === "macos" ||
    platform.startsWith("mac") ||
    userAgent.includes("macintosh")
  )
    return "macos";
  if (
    platform === "windows" ||
    platform.startsWith("win") ||
    userAgent.includes("windows nt")
  )
    return "windows";
  if (
    platform === "linux" ||
    platform.startsWith("linux") ||
    userAgent.includes("linux")
  )
    return "linux";
  return "unknown";
}

function normalizeArchitecture(
  value: string,
): ColonyDownloadPlatform["architecture"] {
  const normalized = value.toLowerCase();
  if (/arm|aarch64/.test(normalized)) return "arm64";
  if (/x86|x64|amd64|64/.test(normalized)) return "x64";
  return "unknown";
}

export async function detectColonyDownloadPlatform(
  navigatorValue: Navigator,
): Promise<ColonyDownloadPlatform> {
  const userAgentData = (
    navigatorValue as Navigator & { userAgentData?: UserAgentData }
  ).userAgentData;
  const operatingSystem = normalizeOperatingSystem(
    navigatorValue,
    userAgentData,
  );
  if (operatingSystem === "ios" || operatingSystem === "android") {
    return { operatingSystem, architecture: "unknown" };
  }
  let architecture = normalizeArchitecture(navigatorValue.userAgent);

  if (userAgentData?.getHighEntropyValues) {
    try {
      const values = await userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
      ]);
      architecture = normalizeArchitecture(
        `${values.architecture ?? ""} ${values.bitness ?? ""}`,
      );
    } catch {
      // Privacy settings may reject high-entropy client hints. The matcher
      // below applies the safest compatible fallback for the detected OS.
    }
  }

  return { operatingSystem, architecture };
}

/**
 * Colony ships one file per desktop OS: an Apple Silicon DMG, an x64 Windows
 * installer and an x64 AppImage. There is no Intel Mac build, and Safari hides
 * the Mac architecture, so an unknown Mac gets the Apple Silicon DMG.
 */
function assetPattern(platform: ColonyDownloadPlatform): RegExp | undefined {
  switch (platform.operatingSystem) {
    case "macos":
      return platform.architecture === "x64"
        ? undefined
        : /^Colony-[^/]*-arm64[^/]*\.dmg$/i;
    case "windows":
      return /^Colony-[^/]*-x64[^/]*\.exe$/i;
    case "linux":
      return platform.architecture === "arm64"
        ? undefined
        : /^Colony-[^/]*-x64[^/]*\.AppImage$/i;
    default:
      return undefined;
  }
}

function desktopVersion(tag: string): [number, number, number] | undefined {
  const match = DESKTOP_TAG_PATTERN.exec(tag);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionsDescending(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
}

/**
 * Pick the newest published desktop release that carries a file for this
 * platform. Only `desktop-v<version>` tags count, so relay, mobile or any other
 * release in the repository can never become a download.
 */
export function selectColonyDownloadUrl(
  releases: GitHubRelease[],
  platform: ColonyDownloadPlatform,
): string | undefined {
  const pattern = assetPattern(platform);
  if (!pattern) return undefined;

  const desktopReleases = releases
    .flatMap((release) => {
      const version = desktopVersion(release.tag_name);
      return version && !release.draft && !release.prerelease
        ? [{ release, version }]
        : [];
    })
    .sort((a, b) => compareVersionsDescending(a.version, b.version));

  for (const { release } of desktopReleases) {
    const asset = release.assets.find(({ name }) => pattern.test(name));
    if (asset) return asset.browser_download_url;
  }
  return undefined;
}

export async function resolveColonyDownloadUrlForPlatform(
  platform: ColonyDownloadPlatform,
): Promise<string> {
  // There are no Colony mobile apps. Everyone else is pointed at the download
  // section, which explains the desktop install.
  if (!assetPattern(platform)) return COLONY_DOWNLOAD_PAGE_URL;

  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as {
      expiresAt: number;
      platform: ColonyDownloadPlatform;
      url: string;
    } | null;
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      cached.platform.operatingSystem === platform.operatingSystem &&
      cached.platform.architecture === platform.architecture
    ) {
      return cached.url;
    }
  } catch {
    // Storage is only an optimization.
  }

  try {
    const response = await fetch(COLONY_RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return COLONY_DOWNLOAD_PAGE_URL;
    const url = selectColonyDownloadUrl(
      (await response.json()) as GitHubRelease[],
      platform,
    );
    if (!url) return COLONY_DOWNLOAD_PAGE_URL;
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          expiresAt: Date.now() + CACHE_TTL_MS,
          platform,
          url,
        }),
      );
    } catch {
      // Storage is only an optimization.
    }
    return url;
  } catch {
    return COLONY_DOWNLOAD_PAGE_URL;
  }
}
