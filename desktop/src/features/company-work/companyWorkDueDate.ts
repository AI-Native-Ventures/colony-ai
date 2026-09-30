import type { CompanyWorkStatus } from "./companyWorkModels";

const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function companyWorkTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function localDateTimeInputToUtc(value: string): string | null {
  const match = LOCAL_DATE_TIME_RE.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function utcToLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCompanyWorkDueDate(
  value: string,
  timeZone = companyWorkTimeZone(),
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")} · ${timeZone}`;
}

export function isCompanyWorkOverdue(
  dueAt: string | undefined,
  status: CompanyWorkStatus,
  now = Date.now(),
): boolean {
  return Boolean(
    dueAt &&
      status !== "done_unverified" &&
      status !== "done_verified" &&
      status !== "archived" &&
      Number.isFinite(Date.parse(dueAt)) &&
      Date.parse(dueAt) < now,
  );
}
