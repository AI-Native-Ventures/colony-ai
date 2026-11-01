import { relayHttpFromWs } from "@/shared/api/inviteHelpers";
import { signRelayEvent } from "@/shared/api/tauri";

import type {
  MoneyLinkBrowserGrant,
  MoneyLinkCard,
  MoneyLinkState,
  MoneyRailConnection,
  MoneyRailsSnapshot,
} from "./moneyRails";
import { providerHost } from "./moneyRails";

const NIP98_KIND = 27235;
const MONEY_RAILS_REQUEST_TIMEOUT_MS = 15_000;
const CARD_QUERY_LIMIT = 200;

type ScopeCheck = () => void;

export class MoneyRailsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "MoneyRailsApiError";
  }
}

export class MoneyRailsNotReadyError extends MoneyRailsApiError {
  constructor() {
    super("Money connections are not ready yet.", 503, "money_not_configured");
    this.name = "MoneyRailsNotReadyError";
  }
}

type PaymentLinkHead = Record<string, unknown> & {
  linkId: string;
  state: MoneyLinkState;
};

type ConnectionHead = Record<string, unknown> & {
  connectionId: string;
  label: string;
  provider: string;
  route: "browser" | "api";
  status: "connected" | "needs_attention" | "disconnected";
};

type LinkQueryItem = {
  headEventId: string;
  link: PaymentLinkHead;
};

type ConnectionQueryItem = {
  headEventId: string;
  connection: ConnectionHead;
  noticeAddress?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) =>
      Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    );
}

async function nip98Header(
  url: string,
  body: string,
  ensureCurrent?: ScopeCheck,
): Promise<string> {
  ensureCurrent?.();
  const payload = await sha256Hex(body);
  ensureCurrent?.();
  const event = await signRelayEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", payload],
      ["nonce", crypto.randomUUID()],
    ],
  });
  ensureCurrent?.();
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function safeErrorMessage(code: string | null, status: number): string {
  if (code === "money_not_configured")
    return "Money connections are not ready yet.";
  if (code === "money_host_not_allowed")
    return "That provider host is not allowed. Check the provider address.";
  if (code === "money_already_connected")
    return "This provider is already connected.";
  if (code === "money_forbidden")
    return "Only a company owner or admin can change money connections.";
  if (code === "conflict")
    return "This payment link changed. Review the latest version.";
  if (status >= 500)
    return "The relay could not complete this request. Try again.";
  return "The relay could not complete this request. Check the details and try again.";
}

async function postJson<T>(
  relayWsUrl: string,
  path: string,
  payload: unknown,
  ensureCurrent?: ScopeCheck,
): Promise<T> {
  const httpBase = relayHttpFromWs(relayWsUrl).replace(/\/+$/u, "");
  const url = `${httpBase}${path}`;
  const body = JSON.stringify(payload);
  const authorization = await nip98Header(url, body, ensureCurrent);
  ensureCurrent?.();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(MONEY_RAILS_REQUEST_TIMEOUT_MS),
  });
  ensureCurrent?.();
  const raw = await response.json().catch(() => ({}));
  const code = isRecord(raw) ? text(raw.code) : null;
  if (!response.ok) {
    const message = safeErrorMessage(code, response.status);
    if (code === "money_not_configured") throw new MoneyRailsNotReadyError();
    throw new MoneyRailsApiError(message, response.status, code);
  }
  return raw as T;
}

function formatDateTime(unixSeconds: number | null): string {
  if (unixSeconds === null) return "";
  const date = new Date(unixSeconds * 1_000);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function formatExpiry(unixSeconds: number | null): string {
  if (unixSeconds === null) return "";
  const date = new Date(unixSeconds * 1_000);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function normalizeRecipientChannel(value: unknown): "WhatsApp" | "Email" {
  return value === "email" || value === "Email" ? "Email" : "WhatsApp";
}

function normalizeBrowserGrant(value: unknown): MoneyLinkBrowserGrant | null {
  if (!isRecord(value)) return null;
  const host = providerHost(text(value.host) ?? "");
  const from = nonNegativeInt(value.from, -1);
  const until = nonNegativeInt(value.until, -1);
  if (host === null || from < 0 || until < from) return null;
  return {
    host,
    from,
    until,
    usedAt:
      typeof value.usedAt === "number" && Number.isSafeInteger(value.usedAt)
        ? value.usedAt
        : null,
  };
}

function normalizePaymentLink(
  eventId: string,
  raw: unknown,
  connections: ReadonlyMap<string, MoneyRailConnection>,
  fullRecipient?: unknown,
): MoneyLinkCard | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.linkId);
  const state = raw.state;
  const partyId = text(raw.partyId);
  const invoiceId = text(raw.invoiceId);
  const recipientRef = text(raw.recipientRef);
  const customerName = text(raw.customerName);
  const purpose = text(raw.purpose);
  const connectionId = text(raw.connectionId);
  const providerLabel = text(raw.providerLabel);
  const amountMinor = nonNegativeInt(raw.amountMinor, -1);
  const currency = text(raw.currency);
  if (
    !id ||
    !partyId ||
    !invoiceId ||
    !recipientRef ||
    !customerName ||
    !purpose ||
    !connectionId ||
    !providerLabel ||
    amountMinor < 0 ||
    !currency ||
    typeof state !== "string" ||
    ![
      "draft",
      "needs_you",
      "creating_link",
      "sent",
      "payment_reported",
      "paid",
      "expired",
      "cancelled",
      "failed",
    ].includes(state)
  )
    return null;
  const connection = connections.get(connectionId);
  const route = raw.route === "api" ? "api" : "browser";
  const recipient = isRecord(fullRecipient)
    ? fullRecipient
    : isRecord(raw.recipient)
      ? raw.recipient
      : null;
  const payment = isRecord(raw.payment) ? raw.payment : null;
  const failure = isRecord(raw.failure) ? raw.failure : null;
  const approval = isRecord(raw.approval) ? raw.approval : null;
  const delivery = isRecord(raw.delivery) ? raw.delivery : null;
  const link = isRecord(raw.link) ? raw.link : null;
  const providerReference =
    text(link?.providerReference) ?? text(payment?.reference);
  const paymentStatus = text(payment?.state);
  const sentAt = nonNegativeInt(delivery?.sentAt, -1);
  const expiresAt = nonNegativeInt(raw.expiresAt, -1);
  const statusDetail =
    text(failure?.reason) ??
    text(raw.cancelReason) ??
    text(payment?.mismatch) ??
    null;
  const rawAddress = text(recipient?.address);
  const displayAddress = text(raw.recipientDisplay);
  const recipientName =
    text(recipient?.name) ?? text(raw.recipientName) ?? "Customer";

  return {
    id,
    headEventId: eventId,
    revision: Math.max(1, nonNegativeInt(raw.version, 1)),
    state: state as MoneyLinkState,
    customerPartyId: partyId,
    invoiceId,
    recipientRef,
    draftedBy: text(raw.draftedBy),
    customerName,
    title: purpose,
    amountMinor,
    currency,
    purpose,
    invoiceLabel: text(raw.invoiceNumber) ?? "",
    provider: {
      connectionId,
      name: providerLabel,
      host: connection?.host ?? "",
      route,
    },
    recipient: {
      name: recipientName,
      channel: normalizeRecipientChannel(raw.recipientChannel),
      address: rawAddress ?? displayAddress ?? "",
    },
    expiresLabel:
      state === "expired"
        ? `Expired ${formatDateTime(expiresAt >= 0 ? expiresAt : null).split(",")[0]}`
        : sentAt >= 0
          ? `Sent ${formatDateTime(sentAt)} on ${normalizeRecipientChannel(delivery?.channel)}`
          : formatExpiry(expiresAt >= 0 ? expiresAt : null),
    message: text(raw.message) ?? "",
    statusDetail:
      statusDetail ??
      (paymentStatus === "reported"
        ? "Notice came in, but Colony has no verified match."
        : null),
    providerReference,
    approvedHeadEventId:
      raw.approvalVoided === true ? null : text(approval?.headEventId),
    expiresInDays: Math.max(1, nonNegativeInt(raw.expiresInDays, 14)),
    browserGrant: normalizeBrowserGrant(raw.browserGrant),
  };
}

function normalizeConnection(
  item: ConnectionQueryItem,
): MoneyRailConnection | null {
  if (!isRecord(item) || !isRecord(item.connection)) return null;
  const connection = item.connection;
  const id = text(connection.connectionId);
  const provider = text(connection.label) ?? text(connection.provider);
  const route = connection.route === "api" ? "api" : "browser";
  const apiHosts = Array.isArray(connection.apiHosts)
    ? connection.apiHosts
    : [];
  const browserHosts = Array.isArray(connection.browserHosts)
    ? connection.browserHosts
    : [];
  const hosts = route === "api" ? apiHosts : browserHosts;
  const host =
    Array.isArray(hosts) && typeof hosts[0] === "string"
      ? providerHost(hosts[0])
      : null;
  if (!id || !provider || !host) return null;
  const rawStatus = connection.status;
  const status =
    rawStatus === "needs_attention"
      ? "needs_reconnect"
      : rawStatus === "disconnected"
        ? "disconnected"
        : "connected";
  const lastUsedAt =
    typeof connection.lastUsedAt === "number" ? connection.lastUsedAt : null;
  return {
    id,
    provider,
    host,
    apiHost: typeof apiHosts[0] === "string" ? providerHost(apiHosts[0]) : null,
    browserHost:
      typeof browserHosts[0] === "string"
        ? providerHost(browserHosts[0])
        : null,
    route,
    status,
    lastUsed: lastUsedAt === null ? null : formatDateTime(lastUsedAt),
    noticeAddress: text(item.noticeAddress) ?? "",
  };
}

export async function fetchMoneyRailsSnapshot(
  relayWsUrl: string,
  partyId?: string,
  ensureCurrent?: ScopeCheck,
): Promise<MoneyRailsSnapshot> {
  try {
    const [connectionResult, linkResult] = await Promise.all([
      postJson<{ connections?: ConnectionQueryItem[] }>(
        relayWsUrl,
        "/api/money-rails/query",
        { what: "connections" },
        ensureCurrent,
      ),
      postJson<{ links?: LinkQueryItem[] }>(
        relayWsUrl,
        "/api/money-rails/query",
        {
          what: "links",
          limit: CARD_QUERY_LIMIT,
          ...(partyId ? { partyId } : {}),
        },
        ensureCurrent,
      ),
    ]);
    const connections = (connectionResult.connections ?? [])
      .map(normalizeConnection)
      .filter((item): item is MoneyRailConnection => item !== null);
    const connectionById = new Map(
      connections.map((connection) => [connection.id, connection]),
    );
    const paymentLinks = (linkResult.links ?? [])
      .filter(
        (item) =>
          isRecord(item) &&
          typeof item.headEventId === "string" &&
          isRecord(item.link),
      )
      .map((item) =>
        normalizePaymentLink(item.headEventId, item.link, connectionById),
      )
      .filter((item): item is MoneyLinkCard => item !== null);
    return {
      paymentLinks,
      connections,
      availability: "ready",
      errorMessage: null,
    };
  } catch (error) {
    if (error instanceof MoneyRailsNotReadyError)
      return {
        paymentLinks: [],
        connections: [],
        availability: "not_ready",
        errorMessage: error.message,
      };
    throw error;
  }
}

export async function fetchMoneyRailLinkDetails(
  relayWsUrl: string,
  linkId: string,
  connections: ReadonlyMap<string, MoneyRailConnection>,
  ensureCurrent?: ScopeCheck,
): Promise<MoneyLinkCard> {
  const result = await postJson<{
    headEventId?: string;
    link?: unknown;
    recipient?: unknown;
  }>(
    relayWsUrl,
    "/api/money-rails/query",
    { what: "link", linkId },
    ensureCurrent,
  );
  const card = normalizePaymentLink(
    text(result.headEventId) ?? "",
    result.link,
    connections,
    result.recipient,
  );
  if (!card?.recipient.address)
    throw new MoneyRailsApiError(
      "The payment link details are unavailable.",
      200,
      "invalid_response",
    );
  return card;
}

function actionDTag(action: {
  type: string;
  linkId?: string;
  connectionId?: string;
}) {
  if (action.linkId) return `paylink:${action.linkId}`;
  if (action.connectionId) return `payconn:${action.connectionId}`;
  return "";
}

export type LiveMoneyRailsAction =
  | {
      type: "approve" | "reject" | "retry";
      linkId: string;
      headEventId: string;
      card: MoneyLinkCard;
      reason?: string;
    }
  | {
      type: "edit";
      linkId: string;
      headEventId: string;
      card: MoneyLinkCard;
      changes: Partial<MoneyLinkCard>;
    }
  | {
      type: "connect";
      provider: string;
      host: string;
      route: "browser" | "api";
      apiKey?: string;
      apiHost?: string;
      authScheme?: string;
      browserHost?: string;
    };

function actionContent(
  action: Exclude<LiveMoneyRailsAction, { type: "connect" }>,
) {
  const op =
    action.type === "approve"
      ? "approve"
      : action.type === "reject"
        ? "reject"
        : action.type === "retry"
          ? "retry"
          : "edit";
  let content: Record<string, unknown> = {
    schemaVersion: 1,
    op,
    linkId: action.linkId,
    expectedHeadEventId: action.headEventId,
  };
  if (action.type === "approve") {
    content.facts = {
      invoiceId: action.card.invoiceId,
      amountMinor: action.card.amountMinor,
      currency: action.card.currency,
      connectionId: action.card.provider.connectionId,
      recipientRef: action.card.recipientRef,
      message: action.card.message,
      expiresInDays: action.card.expiresInDays,
    };
  } else if (action.type === "edit") {
    const recipient = action.changes.recipient ?? action.card.recipient;
    content = {
      ...content,
      ...(typeof action.changes.amountMinor === "number"
        ? { amountMinor: action.changes.amountMinor }
        : {}),
      ...(typeof action.changes.currency === "string"
        ? { currency: action.changes.currency }
        : {}),
      ...(typeof action.changes.purpose === "string"
        ? { purpose: action.changes.purpose }
        : {}),
      ...(typeof action.changes.message === "string"
        ? { message: action.changes.message }
        : {}),
      recipient: {
        channel: recipient.channel.toLowerCase(),
        address: recipient.address,
        name: recipient.name,
      },
    };
  } else if (action.type === "reject") {
    content.reason = action.reason ?? "Rejected by the owner.";
  }
  return content;
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function executeLiveMoneyRailsAction(
  relayWsUrl: string,
  action: LiveMoneyRailsAction,
  ensureCurrent?: ScopeCheck,
): Promise<MoneyRailConnection | MoneyLinkCard | undefined> {
  if (action.type === "connect" && action.route === "api") {
    const host = providerHost(action.apiHost ?? "");
    const browserHost = providerHost(action.browserHost ?? "");
    if (!host) throw new MoneyRailsApiError("Enter a valid API host.", 400);
    const result = await postJson<{
      connection?: ConnectionHead;
      headEventId?: string;
      noticeAddress?: string;
    }>(
      relayWsUrl,
      "/api/money-rails/connect",
      {
        provider: action.provider.toLowerCase(),
        label: action.provider,
        route: "api",
        apiKey: action.apiKey ?? "",
        apiHosts: [host],
        authScheme: action.authScheme ?? "bearer",
        browserHosts: browserHost ? [browserHost] : [],
      },
      ensureCurrent,
    );
    if (!result.connection || !result.headEventId)
      throw new MoneyRailsApiError(
        "The provider connection response was incomplete.",
        200,
        "invalid_response",
      );
    return (
      normalizeConnection({
        connection: result.connection,
        headEventId: result.headEventId,
        noticeAddress: result.noticeAddress,
      }) ?? undefined
    );
  }

  const connectionId = action.type === "connect" ? uuid() : undefined;
  const dTag = actionDTag({
    type: action.type,
    ...(action.type === "connect"
      ? { connectionId }
      : { linkId: action.linkId }),
  });
  if (!dTag) throw new MoneyRailsApiError("Invalid money rails action.", 400);

  const event = await signRelayEvent(
    action.type === "connect"
      ? {
          kind: 47074,
          content: JSON.stringify({
            schemaVersion: 1,
            op: "add_browser",
            connectionId,
            expectedHeadEventId: null,
            provider: action.provider.toLowerCase(),
            label: action.provider,
            browserHosts: [action.host],
          }),
          tags: [["d", dTag]],
        }
      : {
          kind: 47070,
          content: JSON.stringify(actionContent(action)),
          tags: [["d", dTag]],
        },
  );
  ensureCurrent?.();
  const raw = await postJson<{
    accepted?: boolean;
    message?: string;
    code?: string;
  }>(relayWsUrl, "/events", event, ensureCurrent);
  if (raw.accepted === false) {
    const code = text(raw.code);
    throw new MoneyRailsApiError(safeErrorMessage(code, 400), 400, code);
  }
  if (action.type === "connect" && connectionId) {
    const result = await postJson<{ connections?: ConnectionQueryItem[] }>(
      relayWsUrl,
      "/api/money-rails/query",
      { what: "connections" },
      ensureCurrent,
    );
    const created = result.connections?.find(
      (item) => item.connection.connectionId === connectionId,
    );
    return created ? (normalizeConnection(created) ?? undefined) : undefined;
  }
  return undefined;
}

export type PaymentLinkBrowserStep = {
  linkId: string;
  host: string;
  url: string;
  label: string;
  kind: "create";
};

export async function checkMoneyRailBrowserStep(
  relayWsUrl: string,
  step: PaymentLinkBrowserStep,
  ensureCurrent?: ScopeCheck,
): Promise<{
  allow: boolean;
  code: string;
  consumed: boolean;
  until: number | null;
}> {
  const result = await postJson<{
    allow?: unknown;
    code?: unknown;
    consumed?: unknown;
    until?: unknown;
  }>(relayWsUrl, "/api/money-rails/browser-step", step, ensureCurrent);
  return {
    allow: result.allow === true,
    code: text(result.code) ?? "unknown",
    consumed: result.consumed === true,
    until:
      typeof result.until === "number" && Number.isSafeInteger(result.until)
        ? result.until
        : null,
  };
}

export function paymentLinkFromQuery(
  eventId: string,
  raw: unknown,
  connections: ReadonlyMap<string, MoneyRailConnection>,
): MoneyLinkCard | null {
  return normalizePaymentLink(eventId, raw, connections);
}

export function paymentLinkQueryItemFromUnknown(
  raw: unknown,
): { headEventId: string; link: Record<string, unknown> } | null {
  if (!isRecord(raw) || !isRecord(raw.link)) return null;
  const headEventId = text(raw.headEventId);
  return headEventId ? { headEventId, link: raw.link } : null;
}

export function isMoneyLinkState(value: unknown): value is MoneyLinkState {
  return (
    typeof value === "string" &&
    [
      "draft",
      "needs_you",
      "creating_link",
      "sent",
      "payment_reported",
      "paid",
      "expired",
      "cancelled",
      "failed",
    ].includes(value)
  );
}
