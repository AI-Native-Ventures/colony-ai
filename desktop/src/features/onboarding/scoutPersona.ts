import type { ScoutBusinessContext } from "./scoutBusinessContext";
import instructions from "./assets/scout-instructions.txt?raw";
import instructions300 from "./assets/scout-instructions-3.0.0.txt?raw";
import instructions302 from "./assets/scout-instructions-3.0.2.txt?raw";

export const SCOUT_SYSTEM_PROMPT = instructions.trim();
/** Shipped in Colony 3.0.0; still stock, so it is upgraded to the current text. */
const SCOUT_3_0_0_SYSTEM_PROMPT = instructions300.trim();
/** Shipped in Colony 3.0.2 through 3.0.10; still stock, so it is upgraded to the current text. */
const SCOUT_3_0_2_SYSTEM_PROMPT = instructions302.trim();
const SHIPPED_STOCK_PROMPTS = [
  SCOUT_3_0_0_SYSTEM_PROMPT,
  SCOUT_3_0_2_SYSTEM_PROMPT,
];
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
  for (const stock of [SCOUT_SYSTEM_PROMPT, ...SHIPPED_STOCK_PROMPTS]) {
    const profilePrefix = `${stock}${BUSINESS_CONTEXT_PREFIX}`;
    if (!prompt.startsWith(profilePrefix)) continue;
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
    SHIPPED_STOCK_PROMPTS.includes(normalized) ||
    normalized ===
      "You are Scout, the user's Chief of Staff. Help the user get oriented, plan work, create, research, and finish tasks. Be warm, practical, and concise. Be candid about uncertainty." ||
    normalized ===
      "You are Fizz, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work. Add occasional bee wordplay or \u{1f41d}\u{2728}-keep it charming, never distracting." ||
    normalized ===
      "You are Scout, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work."
  );
}
