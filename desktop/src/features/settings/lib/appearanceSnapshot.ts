export type AppearanceSnapshot = {
  version: 1;
  theme: string;
  accent: string;
  followSystem: boolean;
  custom: boolean;
  customLight: [string, string];
  customDark: [string, string];
  glassBackground: boolean;
  glassOpacity: number;
  prominentActiveTab: boolean;
  messageSize: "smaller" | "default" | "larger";
  density: "compact" | "comfortable" | "spacious";
  linkPreview: "compact" | "rich";
  threadLayout: "focus" | "split";
};

/** Persist a full preference snapshot with one storage operation. */
export function writeAppearanceSnapshot(
  storage: Pick<Storage, "setItem">,
  key: string,
  snapshot: AppearanceSnapshot,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export const APPEARANCE_SNAPSHOT_PREFIX = "colony.appearance.v1";

/** Build the stable per-person and per-business key for one appearance save. */
export function appearanceSnapshotKey(
  pubkey: string,
  businessId: string,
): string {
  return `${APPEARANCE_SNAPSHOT_PREFIX}:${pubkey.toLowerCase()}:${businessId}`;
}

/** Track the last business visited to prevent legacy appearance leaking on a switch. */
export function appearanceLastBusinessKey(pubkey: string): string {
  return `${APPEARANCE_SNAPSHOT_PREFIX}:${pubkey.toLowerCase()}:last-business`;
}

/** Accept only complete six-digit hex colors for editable palette stops. */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function hexRgb(value: string): [number, number, number] {
  const color = value.replace("#", "");
  return [
    Number.parseInt(color.slice(0, 2), 16),
    Number.parseInt(color.slice(2, 4), 16),
    Number.parseInt(color.slice(4, 6), 16),
  ];
}

function rgbHex(color: [number, number, number]): string {
  return `#${color
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Blend two six-digit hex colors by the supplied tint ratio. */
export function blendColor(base: string, tint: string, amount: number): string {
  const [baseR, baseG, baseB] = hexRgb(base);
  const [tintR, tintG, tintB] = hexRgb(tint);
  return rgbHex([
    baseR + (tintR - baseR) * amount,
    baseG + (tintG - baseG) * amount,
    baseB + (tintB - baseB) * amount,
  ]);
}

/** Return the reference palette blend used for custom navigation gradients. */
export function customGradientStops(
  colors: [string, string],
  mode: "light" | "dark",
): [string, string] {
  const amount = mode === "light" ? 0.26 : 0.25;
  const base = mode === "light" ? "#ffffff" : "#000000";
  return [
    blendColor(base, colors[0], amount),
    blendColor(base, colors[1], amount),
  ];
}

export function readAppearanceSnapshot(
  key: string,
): Partial<AppearanceSnapshot> | null {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AppearanceSnapshot>;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function mergeAppearanceSnapshot(
  base: AppearanceSnapshot,
  value: Partial<AppearanceSnapshot> | null,
): AppearanceSnapshot {
  if (!value) return base;
  const colors = (candidate: unknown): [string, string] | null => {
    if (
      Array.isArray(candidate) &&
      candidate.length === 2 &&
      candidate.every(
        (color) => typeof color === "string" && isValidHexColor(color),
      )
    ) {
      return [candidate[0], candidate[1]];
    }
    return null;
  };
  const customLight = colors(value.customLight) ?? base.customLight;
  const customDark = colors(value.customDark) ?? base.customDark;
  return {
    ...base,
    ...value,
    version: 1,
    theme: typeof value.theme === "string" ? value.theme : base.theme,
    accent:
      typeof value.accent === "string" &&
      (isValidHexColor(value.accent) || value.accent === "neutral")
        ? value.accent === "neutral"
          ? "#74717B"
          : value.accent
        : base.accent,
    custom: value.custom === true,
    customLight,
    customDark,
    glassBackground: value.glassBackground === true,
    glassOpacity:
      typeof value.glassOpacity === "number"
        ? Math.max(30, Math.min(90, value.glassOpacity))
        : base.glassOpacity,
    prominentActiveTab:
      typeof value.prominentActiveTab === "boolean"
        ? value.prominentActiveTab
        : base.prominentActiveTab,
    messageSize:
      value.messageSize === "smaller" ||
      value.messageSize === "default" ||
      value.messageSize === "larger"
        ? value.messageSize
        : base.messageSize,
    density:
      value.density === "compact" ||
      value.density === "comfortable" ||
      value.density === "spacious"
        ? value.density
        : base.density,
    linkPreview:
      value.linkPreview === "compact" || value.linkPreview === "rich"
        ? value.linkPreview
        : base.linkPreview,
    threadLayout:
      value.threadLayout === "focus" || value.threadLayout === "split"
        ? value.threadLayout
        : base.threadLayout,
  };
}
