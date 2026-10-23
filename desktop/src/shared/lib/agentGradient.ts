/**
 * Each agent keeps its own soft colour pair (Colony 3.0 foundations), so the
 * colour you see on a thread is the colour of who wrote it. The pair is chosen
 * from the agent's name, so it is stable across sessions and devices without
 * any stored setting.
 */
export const AGENT_GRADIENT_PAIRS = [
  ["#FFE08F", "#FFB38F"],
  ["#9FE3D6", "#BFE9A8"],
  ["#F6A6CF", "#BBA7F5"],
  ["#C3B1F7", "#9CC0F8"],
  ["#FFC3A0", "#F49AC1"],
  ["#9CC0F8", "#9FE3D6"],
] as const;

export function agentGradientIndex(name: string): number {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (Math.imul(hash, 97) + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % AGENT_GRADIENT_PAIRS.length;
}

/** CSS `background` for an agent's hexagon cell. */
export function agentGradientFor(name: string): string {
  const [from, to] = AGENT_GRADIENT_PAIRS[agentGradientIndex(name)];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
