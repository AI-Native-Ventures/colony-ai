/**
 * The three colours of the Colony 3.0 sidebar field, chosen by each person.
 *
 * The field is three soft blobs (top, middle, bottom) under a white veil, so
 * the sidebar text stays readable on any light colour. A person's choice is
 * saved with the rest of their appearance (see `communityThemePreference.ts`
 * and the Appearance snapshot) and applied here as three CSS variables on the
 * root. The defaults live in `colony3-sidebar.css`, so applying the default
 * trio removes the overrides and the stylesheet's exact values apply.
 */

export type FieldColors = [top: string, middle: string, bottom: string];

export const FIELD_STORAGE_KEY = "buzz-sidebar-field";

/** Rose, lilac and periwinkle: the design's field and the saved default. */
export const DEFAULT_FIELD_COLORS: FieldColors = [
  "#F5A4D5",
  "#C6B3F4",
  "#94B4FA",
];

export const FIELD_PRESETS: readonly {
  id: "dawn" | "peach" | "sea";
  label: string;
  colors: FieldColors;
}[] = [
  { id: "dawn", label: "Dawn", colors: DEFAULT_FIELD_COLORS },
  { id: "peach", label: "Peach", colors: ["#FFC2A6", "#F5A4D5", "#C6B3F4"] },
  { id: "sea", label: "Sea", colors: ["#A3E3D3", "#9CC2F7", "#C6B3F4"] },
];

/** Names shown beside a slot's hex, for the colours the design names. */
const FIELD_COLOR_NAMES: Record<string, string> = {
  "#F5A4D5": "Rose",
  "#C6B3F4": "Lilac",
  "#94B4FA": "Periwinkle",
  "#FFC2A6": "Peach",
  "#A3E3D3": "Mint",
  "#9CC2F7": "Sky",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Accept only a trio of six-digit hex colours; normalise them to upper case. */
export function parseFieldColors(value: unknown): FieldColors | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((entry) => typeof entry === "string" && HEX.test(entry))) {
    return null;
  }
  const [top, middle, bottom] = value as string[];
  return [top.toUpperCase(), middle.toUpperCase(), bottom.toUpperCase()];
}

export function sameFieldColors(left: FieldColors, right: FieldColors) {
  return left.every(
    (color, index) => color.toUpperCase() === right[index].toUpperCase(),
  );
}

export function isDefaultFieldColors(colors: FieldColors) {
  return sameFieldColors(colors, DEFAULT_FIELD_COLORS);
}

/** The preset a trio matches exactly, if any. */
export function presetForFieldColors(colors: FieldColors) {
  return FIELD_PRESETS.find((preset) => sameFieldColors(preset.colors, colors));
}

/** "Rose · #F5A4D5" for a named colour, the bare hex for any other. */
export function describeFieldColor(color: string): string {
  const hex = color.toUpperCase();
  const name = FIELD_COLOR_NAMES[hex];
  return name ? `${name} · ${hex}` : hex;
}

/**
 * Map the old two-colour custom gradient onto the three-colour field, so a
 * person who chose custom colours keeps them: first colour on top, the second
 * at the bottom and an even blend between them in the middle.
 */
export function fieldColorsFromLegacyGradient(
  colors: readonly [string, string],
): FieldColors | null {
  if (!HEX.test(colors[0]) || !HEX.test(colors[1])) return null;
  return [
    colors[0].toUpperCase(),
    blendHex(colors[0], colors[1], 0.5),
    colors[1].toUpperCase(),
  ];
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function blendHex(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((channel, index) =>
      Math.round(channel + (b[index] - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

const FIELD_VARIABLES = [
  "--colony-field-top",
  "--colony-field-middle",
  "--colony-field-bottom",
  "--colony-rail-top",
  "--colony-rail-middle",
  "--colony-rail-bottom",
] as const;

/** The collapsed rail is a duller wash of the same three colours. */
const RAIL_TINT = "#D9D4DC";
const RAIL_AMOUNT = 0.4;

/** Read the saved trio, falling back to the default when absent or invalid. */
export function readStoredFieldColors(): FieldColors {
  try {
    const raw = window.localStorage.getItem(FIELD_STORAGE_KEY);
    return (
      (raw ? parseFieldColors(JSON.parse(raw)) : null) ?? [
        ...DEFAULT_FIELD_COLORS,
      ]
    );
  } catch {
    return [...DEFAULT_FIELD_COLORS];
  }
}

export function writeStoredFieldColors(colors: FieldColors): void {
  try {
    window.localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // The colours still apply for this session; the saved preference is the
    // synced one, so a full local cache is not a lost choice.
  }
}

/** Apply a trio to the root, or drop the overrides for the exact default. */
export function applyFieldColors(colors: FieldColors): void {
  const root = document.documentElement;
  if (isDefaultFieldColors(colors)) {
    for (const name of FIELD_VARIABLES) root.style.removeProperty(name);
    return;
  }
  const [top, middle, bottom] = colors;
  root.style.setProperty("--colony-field-top", top);
  root.style.setProperty("--colony-field-middle", middle);
  root.style.setProperty("--colony-field-bottom", bottom);
  root.style.setProperty(
    "--colony-rail-top",
    blendHex(top, RAIL_TINT, RAIL_AMOUNT),
  );
  root.style.setProperty(
    "--colony-rail-middle",
    blendHex(middle, RAIL_TINT, RAIL_AMOUNT),
  );
  root.style.setProperty(
    "--colony-rail-bottom",
    blendHex(bottom, RAIL_TINT, RAIL_AMOUNT),
  );
}
