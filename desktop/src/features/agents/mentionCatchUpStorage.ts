/**
 * Mentions a launch-time pass already started an agent for, so a mention the
 * agent deliberately left alone is not started for again on every launch.
 * Per device; losing it only costs one extra look.
 */
const STORAGE_KEY = "colony:mention-catch-up:v1";
const MAX_IDS = 200;

function read(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function createMentionCatchUpStore() {
  let ids = read();
  return {
    has: (id: string) => ids.includes(id),
    add: (id: string) => {
      if (ids.includes(id)) return;
      ids = [...ids, id].slice(-MAX_IDS);
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch {
        // Private window or full storage: the in-memory copy still holds.
      }
    },
  };
}
