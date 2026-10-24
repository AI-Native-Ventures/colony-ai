export function formatAskDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (first: Date, second: Date) =>
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
  const day = sameDay(date, today)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function sameCalendarDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function clockTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

/**
 * When something was decided, as the outcome cards word it: "Today, 13:58",
 * "Yesterday", then "Tue 20 Oct" for anything older.
 */
export function formatDecisionStamp(
  value: string | null | undefined,
  now: Date = new Date(),
) {
  const date = parseDate(value);
  if (!date) return null;
  if (sameCalendarDay(date, now)) return `Today, ${clockTime(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return "Yesterday";
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * A decide-by time: "Today, 14:00", "Tomorrow, 09:00", then "22 Oct, 17:00".
 * `lowercaseDay` words it for a sentence ("Decide by today, 14:00").
 */
export function formatDeadline(
  value: string | null | undefined,
  options: { now?: Date; lowercaseDay?: boolean } = {},
) {
  const date = parseDate(value);
  if (!date) return null;
  const now = options.now ?? new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  let day: string;
  if (sameCalendarDay(date, now)) {
    day = options.lowercaseDay ? "today" : "Today";
  } else if (sameCalendarDay(date, tomorrow)) {
    day = options.lowercaseDay ? "tomorrow" : "Tomorrow";
  } else {
    day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }
  return `${day}, ${clockTime(date)}`;
}

/**
 * A calendar date for the allowance tiles: "31 Oct 2026". The day is read from
 * the stored date itself, so a time zone cannot move an end date.
 */
export function formatTileDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** The clock time alone, for who raised an ask and when. */
export function formatClockTime(value: string | null | undefined) {
  const date = parseDate(value);
  return date ? clockTime(date) : null;
}
