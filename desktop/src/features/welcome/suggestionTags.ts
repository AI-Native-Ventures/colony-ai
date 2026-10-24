/**
 * Tap-to-reply suggestions (owner decision C1): any agent can end a message
 * with up to four short replies the person can tap. The agent adds one
 * `["suggest", "<reply>"]` tag per reply to its stream message.
 */
export const SUGGESTION_TAG = "suggest";
export const MAX_SUGGESTIONS = 4;
export const MAX_SUGGESTION_LENGTH = 60;

export function suggestionsFromTags(
  tags: readonly (readonly string[])[] | undefined,
): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== SUGGESTION_TAG) continue;
    const label = (tag[1] ?? "").trim();
    if (!label || label.length > MAX_SUGGESTION_LENGTH || seen.has(label)) {
      continue;
    }
    seen.add(label);
    suggestions.push(label);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
