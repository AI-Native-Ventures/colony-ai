/** A current durable phone, email, or domain safety decision. */
export type WhatsAppSuppression = Readonly<{
  id: string;
  identityKind: string;
  identityValue: string;
  scope: string;
  reason: string;
  matchedRule: string | null;
  source: string;
  createdAt: string;
  undoneAt: string | null;
}>;

/** A durable stop that applies to every current and future contact for one business. */
export type WhatsAppBusinessStop = Readonly<{
  businessId: string;
  sourceWaId: string;
  reason: string;
  matchedRule: string | null;
  createdAt: string;
}>;

/** Owner-only safety data. Older relays do not expose this query. */
export type WhatsAppSafetyLedger = Readonly<{
  suppressions: readonly WhatsAppSuppression[];
  businessStops: readonly WhatsAppBusinessStop[];
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The relay returned an unreadable WhatsApp ${label}.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, label);
}

function parseWhatsAppSuppression(value: unknown): WhatsAppSuppression {
  const suppression = record(value, "safety suppression");
  return {
    id: stringValue(suppression.id, "safety suppression id"),
    identityKind: stringValue(
      suppression.identityKind,
      "safety suppression identity kind",
    ),
    identityValue: stringValue(
      suppression.identityValue,
      "safety suppression identity value",
    ),
    scope: stringValue(suppression.scope, "safety suppression scope"),
    reason: stringValue(suppression.reason, "safety suppression reason"),
    matchedRule: nullableString(
      suppression.matchedRule,
      "safety suppression matched rule",
    ),
    source: stringValue(suppression.source, "safety suppression source"),
    createdAt: stringValue(
      suppression.createdAt,
      "safety suppression creation time",
    ),
    undoneAt: nullableString(
      suppression.undoneAt,
      "safety suppression undo time",
    ),
  };
}

function parseWhatsAppBusinessStop(value: unknown): WhatsAppBusinessStop {
  const stop = record(value, "business outreach stop");
  return {
    businessId: stringValue(
      stop.businessId,
      "business outreach stop business id",
    ),
    sourceWaId: stringValue(
      stop.sourceWaId,
      "business outreach stop source contact",
    ),
    reason: stringValue(stop.reason, "business outreach stop reason"),
    matchedRule: nullableString(
      stop.matchedRule,
      "business outreach stop matched rule",
    ),
    createdAt: stringValue(
      stop.createdAt,
      "business outreach stop creation time",
    ),
  };
}

/** Parses the owner-only safety ledger returned by relays that support outreach safety. */
export function parseWhatsAppSafetyLedger(
  value: unknown,
): WhatsAppSafetyLedger {
  const ledger = record(value, "safety ledger");
  if (!Array.isArray(ledger.suppressions)) {
    throw new Error(
      "The WhatsApp relay returned an invalid safety suppression list.",
    );
  }
  if (!Array.isArray(ledger.businessStops)) {
    throw new Error(
      "The WhatsApp relay returned an invalid business outreach stop list.",
    );
  }
  return {
    suppressions: ledger.suppressions.map(parseWhatsAppSuppression),
    businessStops: ledger.businessStops.map(parseWhatsAppBusinessStop),
  };
}
