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

/** "2026-10-31" as "31 Oct 2026". */
export function formatEndDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

/** Cents as the board writes money: whole amounts without decimals. */
export function formatUsdFromCents(amountCents: string) {
  const cents = Number(amountCents);
  if (!Number.isFinite(cents)) return `USD ${amountCents}`;
  const amount = cents / 100;
  return `USD ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
