import scoutSvg from "@/features/onboarding/assets/scout.svg?raw";

export type AgentFunction =
  | "Sales"
  | "Operations"
  | "Customer Success"
  | "Finance"
  | "Brand"
  | "Other";

export type AgentAntColor =
  | "green"
  | "coral"
  | "blue"
  | "rose"
  | "gold"
  | "lilac"
  | "teal"
  | "slate"
  | "peach"
  | "sky";

const PALETTE: Record<AgentAntColor, readonly [string, string, string, string]> = {
  green: ["#a5bd8d", "#719763", "#3d694c", "#F0F4EC"],
  coral: ["#F7BCA8", "#E0826B", "#A64B3A", "#FBE6DD"],
  blue: ["#AFCBF6", "#6E97DE", "#2F5DA8", "#E3ECFA"],
  rose: ["#F3B9D0", "#D6739B", "#9A3D63", "#F9E3EC"],
  gold: ["#F4D68C", "#D9A83F", "#8A6417", "#FBF1D7"],
  lilac: ["#CDBDF4", "#9179DA", "#5B45BE", "#ECE6FA"],
  teal: ["#A3DED1", "#4FAE9C", "#216B5F", "#DDF2EC"],
  slate: ["#C9C6D2", "#8E8A99", "#4E4A57", "#ECEBF0"],
  peach: ["#F8CFA0", "#E5A061", "#99602A", "#FCEEDD"],
  sky: ["#B4E0F2", "#62AACB", "#2C6A87", "#E2F2F9"],
};

export const AGENT_ANT_PRESETS = Object.entries(PALETTE).map(([id, colors]) => ({
  id: id as AgentAntColor,
  label: id === "green" ? "Leaf" : id[0].toUpperCase() + id.slice(1),
  color: colors[1],
}));

const FUNCTION_STYLE: Record<AgentFunction, { color: AgentAntColor; prop: string | null }> = {
  Sales: { color: "coral", prop: "sales" },
  Operations: { color: "blue", prop: "operations" },
  "Customer Success": { color: "rose", prop: "heart" },
  Finance: { color: "gold", prop: "finance" },
  Brand: { color: "lilac", prop: "star" },
  Other: { color: "slate", prop: null },
};

export function agentFunctionFromRole(role: string | null | undefined): AgentFunction {
  const value = role?.trim().toLocaleLowerCase() ?? "";
  if (/\bsales\b|\baccount executive\b|\bbusiness development\b/.test(value)) return "Sales";
  if (/\boperations\b|\bops\b|\bproject manager\b/.test(value)) return "Operations";
  if (/\bcustomer success\b|\bsupport\b|\bservice\b/.test(value)) return "Customer Success";
  if (/\bfinance\b|\bbookkeep|\baccountant\b/.test(value)) return "Finance";
  if (/\bbrand\b|\bdesign\b|\bwriter\b|\bmarketing\b/.test(value)) return "Brand";
  return "Other";
}

function mix(hex: string, target: string, amount: number): string {
  const from = hex.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16));
  const to = target.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16));
  if (!from || !to) return hex;
  return `#${from.map((channel, index) => Math.round(channel * (1 - amount) + to[index] * amount).toString(16).padStart(2, "0")).join("")}`;
}

function colorsFor(color: AgentAntColor | string) {
  if (color in PALETTE) return PALETTE[color as AgentAntColor];
  if (!/^#[0-9a-f]{6}$/i.test(color)) return PALETTE.green;
  const base = color.toUpperCase();
  return [mix(base, "#FFFFFF", 0.48), base, mix(base, "#000000", 0.38), mix(base, "#FFFFFF", 0.88)] as const;
}

function stableId(input: string) {
  let hash = 2166136261;
  for (const char of input) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `agent-${(hash >>> 0).toString(16)}`;
}

function gearPath() {
  const points: string[] = [];
  for (let tooth = 0; tooth < 8; tooth += 1) {
    const angle = tooth * 45;
    for (const [radius, delta] of [[7, -15], [9.7, -9], [9.7, 9], [7, 15]]) {
      const radians = ((angle + delta) * Math.PI) / 180;
      points.push(`${(12 + radius * Math.cos(radians)).toFixed(2)} ${(12 + radius * Math.sin(radians)).toFixed(2)}`);
    }
  }
  return `M${points.join("L")}Z`;
}

function propSvg(prop: string | null, deep: string, base: string) {
  const outline = `fill="#FFFFFF" stroke="${deep}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"`;
  switch (prop) {
    case "sales":
      return `<path ${outline} d="M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.6A8 8 0 1 1 20.5 11.5z"/><circle cx="8.6" cy="11.6" r="1.35" fill="${deep}"/><circle cx="12.5" cy="11.6" r="1.35" fill="${deep}"/><circle cx="16.4" cy="11.6" r="1.35" fill="${deep}"/>`;
    case "operations":
      return `<path ${outline} d="${gearPath()}"/><circle cx="12" cy="12" r="2.8" fill="${base}"/>`;
    case "heart":
      return `<path ${outline} d="M12 20.2s-8-4.6-8-10.4A4.5 4.5 0 0 1 12 7.2a4.5 4.5 0 0 1 8 2.6c0 5.8-8 10.4-8 10.4z"/>`;
    case "finance":
      return `<rect ${outline} x="2.8" y="6.2" width="18.4" height="11.6" rx="2.2"/><circle cx="12" cy="12" r="2.9" fill="${base}"/><path fill="none" stroke="${deep}" stroke-width="1.6" stroke-linecap="round" d="M6 9.4v.01M18 14.6v.01"/>`;
    case "star":
      return `<path ${outline} d="M12 3.4l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.4l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"/>`;
    default:
      return "";
  }
}

/** Deterministic data URI using the shipped Scout artwork and role prop. */
export function agentAntAvatarDataUrl(
  role: string | AgentFunction | null | undefined,
  color?: AgentAntColor | string,
): string {
  const functionName = role && role in FUNCTION_STYLE
    ? role as AgentFunction
    : agentFunctionFromRole(role);
  const style = FUNCTION_STYLE[functionName];
  const selectedColor = color ?? style.color;
  const [top, base, deep] = colorsFor(selectedColor);
  const idPrefix = stableId(`${functionName}:${selectedColor}`);
  const svgRoot = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-120 -145 240 235" role="img" aria-label="Scout, eyeless ant agent">';
  let svg = scoutSvg.trim();
  if (!svg.startsWith(svgRoot)) {
    throw new Error("The shipped Scout ant artwork changed shape.");
  }
  svg = svg
    .replaceAll("#a5bd8d", top)
    .replaceAll("#719763", base)
    .replaceAll("#3d694c", deep)
    .replace(/ant-1-/g, `${idPrefix}-`)
    .replace(svgRoot, '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="-120 -145 240 235" aria-hidden="true">');
  const prop = propSvg(style.prop, deep, base);
  if (prop) svg = svg.replace("</svg>", `<g transform="translate(19 5) scale(3.4)">${prop}</g></svg>`);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function agentAntBackground(color?: AgentAntColor | string) {
  return colorsFor(color ?? "green")[3];
}
