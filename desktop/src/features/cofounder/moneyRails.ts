export type MoneyRailRoute = "browser" | "api";

export type MoneyLinkState =
  | "draft"
  | "needs_you"
  | "creating_link"
  | "sent"
  | "payment_reported"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

export type MoneyLinkRecipient = {
  name: string;
  channel: "WhatsApp" | "Email";
  address: string;
};

export type MoneyLinkProvider = {
  connectionId: string;
  name: string;
  host: string;
  route: MoneyRailRoute;
};

export type MoneyLinkBrowserGrant = {
  host: string;
  from: number;
  until: number;
  usedAt: number | null;
};

export type MoneyLinkCard = {
  id: string;
  headEventId: string;
  revision: number;
  state: MoneyLinkState;
  customerPartyId: string;
  invoiceId: string;
  recipientRef: string;
  draftedBy: string | null;
  customerName: string;
  title: string;
  amountMinor: number;
  currency: string;
  purpose: string;
  invoiceLabel: string;
  provider: MoneyLinkProvider;
  recipient: MoneyLinkRecipient;
  expiresLabel: string;
  message: string;
  statusDetail: string | null;
  providerReference: string | null;
  approvedHeadEventId: string | null;
  expiresInDays: number;
  browserGrant: MoneyLinkBrowserGrant | null;
};

export type MoneyRailConnection = {
  id: string;
  provider: string;
  host: string;
  apiHost?: string | null;
  browserHost?: string | null;
  route: MoneyRailRoute;
  status: "connected" | "needs_reconnect" | "disconnected";
  lastUsed: string | null;
  noticeAddress: string;
};

export type MoneyRailsSnapshot = {
  paymentLinks: MoneyLinkCard[];
  connections: MoneyRailConnection[];
  availability?: "loading" | "ready" | "not_ready" | "error";
  errorMessage?: string | null;
};

export type MoneyLinkEdit = Pick<
  MoneyLinkCard,
  | "amountMinor"
  | "currency"
  | "purpose"
  | "recipient"
  | "expiresLabel"
  | "message"
>;

export const EMPTY_MONEY_RAILS: MoneyRailsSnapshot = {
  paymentLinks: [],
  connections: [],
  availability: "loading",
  errorMessage: null,
};

export const MONEY_LINK_STATE_LABEL: Record<MoneyLinkState, string> = {
  draft: "Draft",
  needs_you: "Needs you",
  creating_link: "Creating link",
  sent: "Sent",
  payment_reported: "Payment reported, check",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function moneyLinkCanApprove(
  card: MoneyLinkCard,
  { editing = false, dirty = false } = {},
): boolean {
  return (
    card.state === "needs_you" &&
    card.approvedHeadEventId === null &&
    !editing &&
    !dirty
  );
}

/** Editing creates a fresh review head and invalidates any previous approval. */
export function editMoneyLink(
  card: MoneyLinkCard,
  changes: Partial<MoneyLinkEdit>,
  nextHeadEventId: string,
): MoneyLinkCard {
  return {
    ...card,
    ...changes,
    headEventId: nextHeadEventId,
    revision: card.revision + 1,
    state: "needs_you",
    approvedHeadEventId: null,
    statusDetail: null,
  };
}

export function moneyLabel(amountMinor: number, currency: string): string {
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return currency === "ZAR" ? `R${amount}` : `${currency} ${amount}`;
}

export function providerHost(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    candidate.length > 253 ||
    candidate.length === 0 ||
    candidate.includes("://") ||
    candidate.includes("/") ||
    candidate.includes("@") ||
    candidate.includes("?") ||
    candidate.includes("#")
  )
    return null;
  const labels = candidate.split(".");
  if (
    labels.length < 2 ||
    candidate === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(candidate) ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  )
    return null;
  return candidate;
}

const PAYMENT_LINK_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A single `paylink` message tag links a Scout reply to its company card. */
export function paymentLinkIdFromTags(
  tags: ReadonlyArray<ReadonlyArray<string>> | null | undefined,
): string | null {
  if (!tags) return null;
  const matches = tags.filter(
    (tag) =>
      tag[0] === "paylink" &&
      tag.length === 2 &&
      PAYMENT_LINK_ID.test(tag[1] ?? ""),
  );
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}
