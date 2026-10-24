const VISITS_KEY = "colony-business-visits.v1";
const DAY_MS = 86_400_000;

function readVisits(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VISITS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Remember when this computer last opened a business, for "last visited". */
export function recordBusinessVisit(businessId: string, now = Date.now()) {
  try {
    window.localStorage.setItem(
      VISITS_KEY,
      JSON.stringify({ ...readVisits(), [businessId]: now }),
    );
  } catch {
    // The list simply shows no visit time.
  }
}

/** "today", "yesterday", "3 days ago"... or undefined when never opened here. */
export function lastVisitedLabel(
  businessId: string,
  now = Date.now(),
): string | undefined {
  const at = readVisits()[businessId];
  if (typeof at !== "number") return undefined;
  const startOfDay = (time: number) => {
    const day = new Date(time);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;
  return "a while ago";
}
