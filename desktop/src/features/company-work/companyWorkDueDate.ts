import type { CompanyWorkStatus } from "./companyWorkModels";

export function formatCompanyWorkDueDate(
  value: string,
  timeZone: string,
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
