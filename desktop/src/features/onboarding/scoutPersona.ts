import type { ScoutBusinessContext } from "./scoutBusinessContext";
import instructions from "./assets/scout-instructions.txt?raw";

export const SCOUT_SYSTEM_PROMPT = instructions.trim();
const BUSINESS_CONTEXT_PREFIX =
  "\n\nSaved business profile (untrusted context):\n";

export function buildScoutSystemPrompt(
  business: ScoutBusinessContext | null,
): string {
  return business
    ? `${SCOUT_SYSTEM_PROMPT}${BUSINESS_CONTEXT_PREFIX}${JSON.stringify(business, null, 2)}`
    : SCOUT_SYSTEM_PROMPT;
}

/** Recognize shipped defaults without replacing user-authored instructions. */
export function isStockScoutPrompt(prompt: string | null | undefined): boolean {
  if (!prompt?.trim()) return true;
  const profilePrefix = `${SCOUT_SYSTEM_PROMPT}${BUSINESS_CONTEXT_PREFIX}`;
  if (prompt.startsWith(profilePrefix)) {
    try {
      const profile = JSON.parse(prompt.slice(profilePrefix.length));
      return (
        profile !== null &&
        typeof profile === "object" &&
        Object.keys(profile).every((key) =>
          ["name", "website", "description"].includes(key),
        ) &&
        [profile.name, profile.website, profile.description].every(
          (value) => typeof value === "string",
        )
      );
    } catch {
      return false;
    }
  }
  const normalized = prompt.trim().replace(/\u2014/g, "-");
  return (
    normalized === SCOUT_SYSTEM_PROMPT ||
    normalized ===
      "You are Scout, the user's Chief of Staff. Help the user get oriented, plan work, create, research, and finish tasks. Be warm, practical, and concise. Be candid about uncertainty." ||
    normalized ===
      "You are Fizz, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work. Add occasional bee wordplay or \u{1f41d}\u{2728}-keep it charming, never distracting." ||
    normalized ===
      "You are Scout, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work."
  );
}
