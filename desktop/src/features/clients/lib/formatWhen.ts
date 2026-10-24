const TIME = new Intl.DateTimeFormat("en-ZA", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
});
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
];

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** "today", "yesterday" or "21 Oct", for a Unix timestamp in seconds. */
export function dayLabel(seconds: number, now = new Date()): string {
  const date = new Date(seconds * 1_000);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "14:05", for a Unix timestamp in seconds. */
export function clockTime(seconds: number): string {
  return TIME.format(new Date(seconds * 1_000));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Today, 14:05" or "20 Oct, 14:05". */
export function whenLabel(seconds: number, now = new Date()): string {
  return `${capitalize(dayLabel(seconds, now))}, ${clockTime(seconds)}`;
}

/** "today", "yesterday" or "on 21 Oct": reads after a verb ("shared ... on 21 Oct"). */
export function onDayLabel(seconds: number, now = new Date()): string {
  const label = dayLabel(seconds, now);
  return label === "today" || label === "yesterday" ? label : `on ${label}`;
}
