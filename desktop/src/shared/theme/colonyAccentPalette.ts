export const ACCENT_COLORS = [
  { name: "Violet", value: "#5B45BE" },
  { name: "Rose", value: "#B23A6E" },
  { name: "Teal", value: "#1F7A70" },
  { name: "Blue", value: "#2B5899" },
  { name: "Amber", value: "#9A5B00" },
  { name: "Ink", value: "#25222C" },
] as const;

export const DEFAULT_ACCENT = ACCENT_COLORS[0].value;

export const DARK_ACCENT_PALETTE_FALLBACKS = {
  overlay: "#302d39",
  surface: "#1a1920",
} as const;

const DARK_ACCENT_TEXT_CONTRAST = 4.8;

type Rgb = { r: number; g: number; b: number };

export type ColonyAccentPalette = {
  accentHex: string;
  accentSoftHex: string;
  accentInkHex: string;
  accentForegroundHex: string;
};

export type ColonyAccentMode = "light" | "dark";

export type DarkAccentSurfaces = {
  overlay: string;
  surface: string;
};

function hexToRgb(hex: string): Rgb {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/iu.exec(hex);
  if (!match) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function mixRgb(from: Rgb, to: Rgb, factor: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * factor,
    g: from.g + (to.g - from.g) * factor,
    b: from.b + (to.b - from.b) * factor,
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const aLum = relativeLuminance(a);
  const bLum = relativeLuminance(b);
  return (Math.max(aLum, bLum) + 0.05) / (Math.min(aLum, bLum) + 0.05);
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b]
    .map((channel) => clamp(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function darkAccentPalette(
  hex: string,
  surfaces: DarkAccentSurfaces,
): ColonyAccentPalette {
  const overlay = hexToRgb(surfaces.overlay);
  const surface = hexToRgb(surfaces.surface);
  const accent = hexToRgb(hex);
  const white = { r: 255, g: 255, b: 255 };
  let low = 0;
  let high = 1;

  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (
      contrastRatio(mixRgb(accent, white, mid), overlay) >=
      DARK_ACCENT_TEXT_CONTRAST
    ) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const accentHex = rgbToHex(mixRgb(accent, white, high));
  const accentSoftHex = rgbToHex(mixRgb(surface, hexToRgb(accentHex), 0.12));
  return {
    accentHex,
    accentSoftHex,
    accentInkHex: accentHex,
    accentForegroundHex: surfaces.surface,
  };
}

/** Resolve the selected accent without changing its light-mode appearance. */
export function resolveColonyAccentPalette(
  hex: string,
  mode: ColonyAccentMode,
  darkSurfaces: DarkAccentSurfaces = DARK_ACCENT_PALETTE_FALLBACKS,
): ColonyAccentPalette {
  if (mode === "dark") return darkAccentPalette(hex, darkSurfaces);

  const accent = hexToRgb(hex);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  return {
    accentHex: hex,
    accentSoftHex: rgbToHex(mixRgb(accent, white, 0.9)),
    accentInkHex: rgbToHex(mixRgb(accent, black, 0.15)),
    accentForegroundHex: "#fffdfa",
  };
}
