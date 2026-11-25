export function dayKey(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function messageDayLabel(value: string): string {
  const today = dayKey(new Date());
  const messageDay = dayKey(value);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (messageDay === today) return "Today";
  if (messageDay === dayKey(yesterdayDate)) return "Yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function windowTimeRemaining(value: string | null): string {
  if (!value) return "";
  const minutes = Math.max(
    0,
    Math.ceil((Date.parse(value) - Date.now()) / 60_000),
  );
  if (minutes >= 60) return `${Math.ceil(minutes / 60)}h left`;
  return `${Math.max(1, minutes)}m left`;
}
