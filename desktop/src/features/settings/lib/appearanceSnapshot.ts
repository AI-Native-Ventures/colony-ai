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
  const bases =
    mode === "light" ? ["#fae7ed", "#94b4fa"] : ["#38273f", "#223570"];
  return [
    blendColor(bases[0], colors[0], amount),
    blendColor(bases[1], colors[1], amount),
  ];
}
