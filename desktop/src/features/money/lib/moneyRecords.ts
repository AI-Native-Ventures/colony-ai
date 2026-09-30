import type { RelayEvent } from "@/shared/api/types";
import { MAX_EXPLICIT_CHANNEL_VALUES } from "@/shared/api/relayClientShared";
import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_INVOICE_HEAD,
  KIND_INVOICE_VERSION,
  KIND_MONEY_ADJUSTMENT,
  KIND_MONEY_FOLLOW_UP,
  KIND_MONEY_FOLLOW_UP_HEAD,
  KIND_PAYMENT,
} from "@/shared/constants/kinds";
import type { EventRecord } from "@/features/clients/lib/businessRecords";
import { BusinessRecordParseError } from "@/features/clients/lib/businessRecordErrors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32_RE = /^[0-9a-f]{64}$/;
export const MAX_MONEY_RECORD_EVENTS = 5_000;

export type InvoiceStatus = "draft" | "issued" | "void";
export type InvoiceVersionAction =
  | "proposal_acceptance"
  | "draft_edit"
  | "issue"
  | "void";
export type MoneyAdjustmentType = "credit_note" | "refund" | "write_off";
export type MoneyFollowUpStatus = "draft" | "in_review" | "approved";
export type MoneyFollowUpActionKind = "draft" | "review" | "approve";

export type InvoiceLine = {
  serviceId: string | null;
  description: string;
  quantityHundredths: number;
  unitAmountMinor: number;
};

export type InvoiceTaxLine = {
  label: string | null;
  rateBasisPoints: number;
};

export type MoneyInvoiceHead = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  proposalId: string;
  proposalVersionEventId: string;
  currency: string;
  lines: InvoiceLine[];
  taxLines: InvoiceTaxLine[];
  sellerTaxNumber: string | null;
  customerTaxNumber: string | null;
  totalMinor: number;
  creditedMinor: number;
  writtenOffMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  paymentEvidenceCount: number;
  version: number;
  currentVersionEventId: string;
  status: InvoiceStatus;
  dueAt: number | null;
  issuedAt: number | null;
  sourceEventId: string;
};

export type MoneyInvoiceVersion = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  version: number;
  previousVersionEventId: string | null;
  proposalVersionEventId: string | null;
  expectedHeadEventId: string | null;
  action: InvoiceVersionAction;
  currency: string;
  lines: InvoiceLine[];
  taxLines: InvoiceTaxLine[];
  sellerTaxNumber: string | null;
  customerTaxNumber: string | null;
  totalMinor: number;
  status: InvoiceStatus;
  dueAt: number | null;
  voidReason: string | null;
};

export type MoneyPaymentEvidence = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  paymentId: string;
  provider: string;
  providerReference: string | null;
  amountMinor: number;
  currency: string;
  occurredAt: number;
  evidenceRef: string;
  expectedInvoiceHeadEventId: string;
};

export type MoneyAdjustment = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  adjustmentId: string;
  adjustmentType: MoneyAdjustmentType;
  amountMinor: number;
  currency: string;
  reason: string;
  evidenceRef: string;
  occurredAt: number;
  expectedInvoiceHeadEventId: string;
};

export type MoneyFollowUpAction = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  followUpId: string;
  action: MoneyFollowUpActionKind;
  expectedHeadEventId: string | null;
  expectedInvoiceHeadEventId: string;
  dueAt: number | null;
  draftContent: string;
};

export type MoneyFollowUpHead = {
  schemaVersion: number;
  clientId: string;
  invoiceId: string;
  followUpId: string;
  status: MoneyFollowUpStatus;
  version: number;
  currentVersionEventId: string;
  dueAt: number | null;
  draftContent: string;
  approvalIntentOnly: boolean;
  approvedByPubkey: string | null;
  approvedAt: number | null;
  sourceEventId: string;
};

export type MoneyWorkspaceRecords = {
  invoiceHeads: EventRecord<MoneyInvoiceHead>[];
  invoiceVersions: EventRecord<MoneyInvoiceVersion>[];
  payments: EventRecord<MoneyPaymentEvidence>[];
  adjustments: EventRecord<MoneyAdjustment>[];
  followUpHeads: EventRecord<MoneyFollowUpHead>[];
  followUpActions: EventRecord<MoneyFollowUpAction>[];
};

export function invoiceIssueMissingDetails(
  invoice: MoneyInvoiceHead,
): string[] {
  const missing: string[] = [];
  if (!invoice.clientId.trim()) missing.push("Client");
  if (!/^[A-Z]{3}$/.test(invoice.currency)) missing.push("Currency");
  if (
    !invoice.lines.length ||
    invoice.lines.some(
      (line) =>
        !line.description.trim() ||
        !Number.isSafeInteger(line.quantityHundredths) ||
        line.quantityHundredths <= 0 ||
        !Number.isSafeInteger(line.unitAmountMinor) ||
        line.unitAmountMinor < 0,
    )
  ) {
    missing.push("Invoice lines");
  }
  if (
    invoice.dueAt === null ||
    !Number.isSafeInteger(invoice.dueAt) ||
    invoice.dueAt <= 0
  ) {
    missing.push("Due date");
  }
  return missing;
}

export const MONEY_RECORD_KINDS = [
  KIND_INVOICE_HEAD,
  KIND_INVOICE_VERSION,
  KIND_PAYMENT,
  KIND_MONEY_ADJUSTMENT,
  KIND_MONEY_FOLLOW_UP_HEAD,
  KIND_MONEY_FOLLOW_UP,
] as const;

export function moneyInvoiceDTag(clientId: string, invoiceId: string): string {
  return `client:${canonicalUuid(clientId, "client id")}:invoice:${canonicalUuid(invoiceId, "invoice id")}`;
}

export function moneyInvoiceVersionDTag(
  clientId: string,
  invoiceId: string,
  version: number,
): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("invoice version must be a positive integer");
  }
  return `${moneyInvoiceDTag(clientId, invoiceId)}:version:${version}`;
}

export function moneyPaymentDTag(clientId: string, paymentId: string): string {
  return `client:${canonicalUuid(clientId, "client id")}:payment:${canonicalUuid(paymentId, "payment id")}`;
}

export function moneyAdjustmentDTag(
  clientId: string,
  adjustmentId: string,
): string {
  return `client:${canonicalUuid(clientId, "client id")}:money-adjustment:${canonicalUuid(adjustmentId, "adjustment id")}`;
}

export function moneyFollowUpDTag(
  clientId: string,
  followUpId: string,
): string {
  return `client:${canonicalUuid(clientId, "client id")}:money-follow-up:${canonicalUuid(followUpId, "follow-up id")}`;
}

export function moneyRecordTemplate<T extends { clientId: string }>(
  kind: number,
  value: T,
  dTag: string,
) {
  return {
    kind,
    content: JSON.stringify(value),
    tags: [
      ["h", canonicalUuid(value.clientId, "client id")],
      ["d", dTag],
    ],
  };
}

export function parseMoneyRecord(
  event: RelayEvent,
):
  | EventRecord<MoneyInvoiceHead>
  | EventRecord<MoneyInvoiceVersion>
  | EventRecord<MoneyPaymentEvidence>
  | EventRecord<MoneyAdjustment>
  | EventRecord<MoneyFollowUpHead>
  | EventRecord<MoneyFollowUpAction> {
  switch (event.kind) {
    case KIND_INVOICE_HEAD:
      return { event, value: parseInvoiceHead(event) };
    case KIND_INVOICE_VERSION:
      return { event, value: parseInvoiceVersion(event) };
    case KIND_PAYMENT:
      return { event, value: parsePayment(event) };
    case KIND_MONEY_ADJUSTMENT:
      return { event, value: parseAdjustment(event) };
    case KIND_MONEY_FOLLOW_UP_HEAD:
      return { event, value: parseFollowUpHead(event) };
    case KIND_MONEY_FOLLOW_UP:
      return { event, value: parseFollowUpAction(event) };
    default:
      throw new BusinessRecordParseError("unsupported money record kind");
  }
}

export function parseMoneyRecords(
  events: readonly RelayEvent[],
  allowedClientIds: readonly string[],
): MoneyWorkspaceRecords {
  const allowed = new Set(
    allowedClientIds.map((id) => canonicalUuid(id, "client id")),
  );
  const records: MoneyWorkspaceRecords = {
    invoiceHeads: [],
    invoiceVersions: [],
    payments: [],
    adjustments: [],
    followUpHeads: [],
    followUpActions: [],
  };
  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    const record = parseMoneyRecord(event);
    if (!allowed.has(record.value.clientId)) {
      throw new BusinessRecordParseError(
        "money record query returned another client channel",
      );
    }
    switch (event.kind) {
      case KIND_INVOICE_HEAD:
        records.invoiceHeads.push(record as EventRecord<MoneyInvoiceHead>);
        break;
      case KIND_INVOICE_VERSION:
        records.invoiceVersions.push(
          record as EventRecord<MoneyInvoiceVersion>,
        );
        break;
      case KIND_PAYMENT:
        records.payments.push(record as EventRecord<MoneyPaymentEvidence>);
        break;
      case KIND_MONEY_ADJUSTMENT:
        records.adjustments.push(record as EventRecord<MoneyAdjustment>);
        break;
      case KIND_MONEY_FOLLOW_UP_HEAD:
        records.followUpHeads.push(record as EventRecord<MoneyFollowUpHead>);
        break;
      case KIND_MONEY_FOLLOW_UP:
        records.followUpActions.push(
          record as EventRecord<MoneyFollowUpAction>,
        );
        break;
      default:
        throw new BusinessRecordParseError("unsupported money record kind");
    }
  }
  return records;
}

export function createMoneyRecordService(relay = relayClient) {
  return {
    async list(channelIds: readonly string[]): Promise<MoneyWorkspaceRecords> {
      if (channelIds.length === 0) return parseMoneyRecords([], []);
      const normalized = [
        ...new Set(
          channelIds.map((id) => canonicalUuid(id, "client channel id")),
        ),
      ];
      const events: RelayEvent[] = [];
      for (
        let index = 0;
        index < normalized.length;
        index += MAX_EXPLICIT_CHANNEL_VALUES
      ) {
        const batch = normalized.slice(
          index,
          index + MAX_EXPLICIT_CHANNEL_VALUES,
        );
        const response = await relay.fetchEvents({
          kinds: [...MONEY_RECORD_KINDS],
          "#h": batch,
          limit: MAX_MONEY_RECORD_EVENTS + 1,
        });
        events.push(...response);
        if (events.length > MAX_MONEY_RECORD_EVENTS) {
          throw new BusinessRecordParseError(
            "The money history exceeds the current record limit",
          );
        }
      }
      return parseMoneyRecords(events, normalized);
    },
  };
}

export const moneyRecordService = createMoneyRecordService();

export type MoneyTotals = {
  invoicedMinorByCurrency: Record<string, number>;
  collectedMinorByCurrency: Record<string, number>;
  outstandingMinorByCurrency: Record<string, number>;
  overdueMinorByCurrency: Record<string, number>;
};

export function deriveMoneyTotals(
  records: MoneyWorkspaceRecords,
  period: string,
  clientId: string | null,
  nowSeconds: number,
): MoneyTotals {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error("Money period must use YYYY-MM format");
  }
  const selectedClient = clientId ? canonicalUuid(clientId, "client id") : null;
  const inScope = (record: { clientId: string }) =>
    selectedClient === null || record.clientId === selectedClient;
  const periodOf = (timestamp: number | null | undefined) =>
    timestamp === null || timestamp === undefined
      ? null
      : new Date(timestamp * 1_000).toISOString().slice(0, 7);
  const invoices = records.invoiceHeads.filter(
    ({ value }) =>
      inScope(value) &&
      value.status === "issued" &&
      value.issuedAt !== null &&
      periodOf(value.issuedAt) === period,
  );
  const totals: MoneyTotals = {
    invoicedMinorByCurrency: Object.create(null) as Record<string, number>,
    collectedMinorByCurrency: Object.create(null) as Record<string, number>,
    outstandingMinorByCurrency: Object.create(null) as Record<string, number>,
    overdueMinorByCurrency: Object.create(null) as Record<string, number>,
  };
  for (const { value } of invoices) {
    addAmount(totals.invoicedMinorByCurrency, value.currency, value.totalMinor);
    addAmount(
      totals.outstandingMinorByCurrency,
      value.currency,
      value.outstandingMinor,
    );
    if (
      value.outstandingMinor > 0 &&
      value.dueAt !== null &&
      value.dueAt < nowSeconds
    ) {
      addAmount(
        totals.overdueMinorByCurrency,
        value.currency,
        value.outstandingMinor,
      );
    }
  }
  for (const { value } of records.adjustments) {
    if (!inScope(value) || periodOf(value.occurredAt) !== period) continue;
    if (value.adjustmentType === "credit_note") {
      addAmount(
        totals.invoicedMinorByCurrency,
        value.currency,
        -value.amountMinor,
      );
    } else if (value.adjustmentType === "refund") {
      addAmount(
        totals.collectedMinorByCurrency,
        value.currency,
        -value.amountMinor,
      );
    }
  }
  for (const { value } of records.payments) {
    if (inScope(value) && periodOf(value.occurredAt) === period) {
      addAmount(
        totals.collectedMinorByCurrency,
        value.currency,
        value.amountMinor,
      );
    }
  }
  for (const amounts of Object.values(totals)) {
    for (const [currency, amount] of Object.entries(amounts)) {
      if (amount < 0) amounts[currency] = 0;
    }
  }
  return totals;
}

export function formatMoneyMinor(
  amountMinor: number,
  currency: string,
): string {
  assertSafeInteger(amountMinor, "money amount");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter uppercase code");
  }
  const digits =
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const currencyFormatter = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const scale = 10n ** BigInt(digits);
  const absolute = BigInt(Math.abs(amountMinor));
  const whole = absolute / scale;
  const remainder = absolute % scale;
  const fractional =
    digits && remainder > 0n
      ? remainder.toString().padStart(digits, "0").replace(/0+$/, "")
      : "";
  const parts = currencyFormatter.formatToParts(whole);
  const numeric = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.type === "integer" || part.type === "group");
  const firstNumeric = numeric[0]?.index ?? 0;
  const lastNumeric = numeric.at(-1)?.index ?? firstNumeric;
  const prefix = parts
    .slice(0, firstNumeric)
    .map(({ value }) => value)
    .join("");
  const suffix = parts
    .slice(lastNumeric + 1)
    .map(({ value }) => value)
    .join("");
  const groupedWhole = numeric.map(({ part }) => part.value).join("");
  const decimal = new Intl.NumberFormat("en-ZA")
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value;
  const sign = amountMinor < 0 ? "−" : "";
  return `${sign}${prefix}${groupedWhole}${fractional && decimal ? decimal + fractional : ""}${suffix}`;
}

export function invoiceLineMinor(line: InvoiceLine): number {
  const amount =
    (BigInt(line.quantityHundredths) * BigInt(line.unitAmountMinor)) / 100n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BusinessRecordParseError(
      "invoice line amount exceeds the safe display range",
    );
  }
  return Number(amount);
}

export function invoiceTaxTotalMinor(
  lines: readonly InvoiceLine[],
  taxLines: readonly InvoiceTaxLine[],
): number {
  let total = 0n;
  for (const line of lines) {
    const lineMinor = BigInt(invoiceLineMinor(line));
    for (const taxLine of taxLines) {
      const taxMinor =
        (lineMinor * BigInt(taxLine.rateBasisPoints) + 5_000n) / 10_000n;
      total += taxMinor;
    }
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invoice tax exceeds the supported display range.");
  }
  return Number(total);
}

export function totalInvoiceMinor(
  lines: readonly InvoiceLine[],
  taxLines: readonly InvoiceTaxLine[],
): number {
  const subtotal = lines.reduce(
    (total, line) => total + BigInt(invoiceLineMinor(line)),
    0n,
  );
  const total = subtotal + BigInt(invoiceTaxTotalMinor(lines, taxLines));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invoice total exceeds the supported display range.");
  }
  return Number(total);
}

export function parseMoneyInput(
  value: string,
  currency: string,
  allowZero = false,
): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter uppercase code");
  }
  const digits =
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match || (match[2]?.length ?? 0) > digits) {
    throw new Error(`Enter an amount with up to ${digits} decimal places`);
  }
  const scale = 10n ** BigInt(digits);
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const minor = BigInt(match[1]) * scale + BigInt(fraction || "0");
  if (
    minor < (allowZero ? 0n : 1n) ||
    minor > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(
      allowZero
        ? "Amount must be a non-negative whole number of minor units"
        : "Amount must be a positive whole number of minor units",
    );
  }
  return Number(minor);
}

function parseInvoiceHead(event: RelayEvent): MoneyInvoiceHead {
  const value = parseContent(
    event,
    KIND_INVOICE_HEAD,
    [
      "schemaVersion",
      "clientId",
      "invoiceId",
      "proposalId",
      "proposalVersionEventId",
      "currency",
      "lines",
      "totalMinor",
      "creditedMinor",
      "writtenOffMinor",
      "collectedMinor",
      "outstandingMinor",
      "paymentEvidenceCount",
      "version",
      "currentVersionEventId",
      "status",
      "dueAt",
      "issuedAt",
      "sourceEventId",
    ],
    ["taxLines", "sellerTaxNumber", "customerTaxNumber"],
  );
  const clientId = readUuid(value, "clientId");
  const invoiceId = readUuid(value, "invoiceId");
  validateCoordinates(event, clientId, moneyInvoiceDTag(clientId, invoiceId));
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId,
    proposalId: readUuid(value, "proposalId"),
    proposalVersionEventId: readHex(value, "proposalVersionEventId"),
    currency: readCurrency(value, "currency"),
    lines: readLines(value, "lines"),
    taxLines: readTaxLines(value, "taxLines"),
    sellerTaxNumber: readOptionalNonEmptyString(value, "sellerTaxNumber", 128),
    customerTaxNumber: readOptionalNonEmptyString(
      value,
      "customerTaxNumber",
      128,
    ),
    totalMinor: readInteger(value, "totalMinor", 0),
    creditedMinor: readInteger(value, "creditedMinor", 0),
    writtenOffMinor: readInteger(value, "writtenOffMinor", 0),
    collectedMinor: readInteger(value, "collectedMinor", 0),
    outstandingMinor: readInteger(value, "outstandingMinor", 0),
    paymentEvidenceCount: readInteger(value, "paymentEvidenceCount", 0),
    version: readInteger(value, "version", 1),
    currentVersionEventId: readHex(value, "currentVersionEventId"),
    status: readEnum(value, "status", ["draft", "issued", "void"]),
    dueAt: readNullableInteger(value, "dueAt"),
    issuedAt: readNullableInteger(value, "issuedAt"),
    sourceEventId: readHex(value, "sourceEventId"),
  };
}

function parseInvoiceVersion(event: RelayEvent): MoneyInvoiceVersion {
  const value = parseContent(
    event,
    KIND_INVOICE_VERSION,
    [
      "schemaVersion",
      "clientId",
      "invoiceId",
      "version",
      "previousVersionEventId",
      "proposalVersionEventId",
      "expectedHeadEventId",
      "action",
      "currency",
      "lines",
      "totalMinor",
      "status",
      "dueAt",
      "voidReason",
    ],
    ["taxLines", "sellerTaxNumber", "customerTaxNumber"],
  );
  const clientId = readUuid(value, "clientId");
  const invoiceId = readUuid(value, "invoiceId");
  const version = readInteger(value, "version", 1);
  validateCoordinates(
    event,
    clientId,
    moneyInvoiceVersionDTag(clientId, invoiceId, version),
  );
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId,
    version,
    previousVersionEventId: readNullableHex(value, "previousVersionEventId"),
    proposalVersionEventId: readNullableHex(value, "proposalVersionEventId"),
    expectedHeadEventId: readNullableHex(value, "expectedHeadEventId"),
    action: readEnum(value, "action", [
      "proposal_acceptance",
      "draft_edit",
      "issue",
      "void",
    ]),
    currency: readCurrency(value, "currency"),
    lines: readLines(value, "lines"),
    taxLines: readTaxLines(value, "taxLines"),
    sellerTaxNumber: readOptionalNonEmptyString(value, "sellerTaxNumber", 128),
    customerTaxNumber: readOptionalNonEmptyString(
      value,
      "customerTaxNumber",
      128,
    ),
    totalMinor: readInteger(value, "totalMinor", 0),
    status: readEnum(value, "status", ["draft", "issued", "void"]),
    dueAt: readNullableInteger(value, "dueAt"),
    voidReason: readNullableString(value, "voidReason"),
  };
}

function parsePayment(event: RelayEvent): MoneyPaymentEvidence {
  const value = parseContent(event, KIND_PAYMENT, [
    "schemaVersion",
    "clientId",
    "invoiceId",
    "paymentId",
    "provider",
    "providerReference",
    "amountMinor",
    "currency",
    "occurredAt",
    "evidenceRef",
    "expectedInvoiceHeadEventId",
  ]);
  const clientId = readUuid(value, "clientId");
  const paymentId = readUuid(value, "paymentId");
  validateCoordinates(event, clientId, moneyPaymentDTag(clientId, paymentId));
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId: readUuid(value, "invoiceId"),
    paymentId,
    provider: readString(value, "provider"),
    providerReference: readNullableString(value, "providerReference"),
    amountMinor: readInteger(value, "amountMinor", 1),
    currency: readCurrency(value, "currency"),
    occurredAt: readInteger(value, "occurredAt", 1),
    evidenceRef: readNonEmptyString(value, "evidenceRef"),
    expectedInvoiceHeadEventId: readHex(value, "expectedInvoiceHeadEventId"),
  };
}

function parseAdjustment(event: RelayEvent): MoneyAdjustment {
  const value = parseContent(event, KIND_MONEY_ADJUSTMENT, [
    "schemaVersion",
    "clientId",
    "invoiceId",
    "adjustmentId",
    "adjustmentType",
    "amountMinor",
    "currency",
    "reason",
    "evidenceRef",
    "occurredAt",
    "expectedInvoiceHeadEventId",
  ]);
  const clientId = readUuid(value, "clientId");
  const adjustmentId = readUuid(value, "adjustmentId");
  validateCoordinates(
    event,
    clientId,
    moneyAdjustmentDTag(clientId, adjustmentId),
  );
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId: readUuid(value, "invoiceId"),
    adjustmentId,
    adjustmentType: readEnum(value, "adjustmentType", [
      "credit_note",
      "refund",
      "write_off",
    ]),
    amountMinor: readInteger(value, "amountMinor", 1),
    currency: readCurrency(value, "currency"),
    reason: readNonEmptyString(value, "reason"),
    evidenceRef: readNonEmptyString(value, "evidenceRef"),
    occurredAt: readInteger(value, "occurredAt", 1),
    expectedInvoiceHeadEventId: readHex(value, "expectedInvoiceHeadEventId"),
  };
}

function parseFollowUpHead(event: RelayEvent): MoneyFollowUpHead {
  const value = parseContent(event, KIND_MONEY_FOLLOW_UP_HEAD, [
    "schemaVersion",
    "clientId",
    "invoiceId",
    "followUpId",
    "status",
    "version",
    "currentVersionEventId",
    "dueAt",
    "draftContent",
    "approvalIntentOnly",
    "approvedByPubkey",
    "approvedAt",
    "sourceEventId",
  ]);
  const clientId = readUuid(value, "clientId");
  const followUpId = readUuid(value, "followUpId");
  validateCoordinates(event, clientId, moneyFollowUpDTag(clientId, followUpId));
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId: readUuid(value, "invoiceId"),
    followUpId,
    status: readEnum(value, "status", ["draft", "in_review", "approved"]),
    version: readInteger(value, "version", 1),
    currentVersionEventId: readHex(value, "currentVersionEventId"),
    dueAt: readNullableInteger(value, "dueAt"),
    draftContent: readNonEmptyString(value, "draftContent"),
    approvalIntentOnly: readBoolean(value, "approvalIntentOnly"),
    approvedByPubkey: readNullableHex(value, "approvedByPubkey"),
    approvedAt: readNullableInteger(value, "approvedAt"),
    sourceEventId: readHex(value, "sourceEventId"),
  };
}

function parseFollowUpAction(event: RelayEvent): MoneyFollowUpAction {
  const value = parseContent(event, KIND_MONEY_FOLLOW_UP, [
    "schemaVersion",
    "clientId",
    "invoiceId",
    "followUpId",
    "action",
    "expectedHeadEventId",
    "expectedInvoiceHeadEventId",
    "dueAt",
    "draftContent",
  ]);
  const clientId = readUuid(value, "clientId");
  const followUpId = readUuid(value, "followUpId");
  validateCoordinates(event, clientId, moneyFollowUpDTag(clientId, followUpId));
  return {
    schemaVersion: readInteger(value, "schemaVersion", 1),
    clientId,
    invoiceId: readUuid(value, "invoiceId"),
    followUpId,
    action: readEnum(value, "action", ["draft", "review", "approve"]),
    expectedHeadEventId: readNullableHex(value, "expectedHeadEventId"),
    expectedInvoiceHeadEventId: readHex(value, "expectedInvoiceHeadEventId"),
    dueAt: readNullableInteger(value, "dueAt"),
    draftContent: readNonEmptyString(value, "draftContent"),
  };
}

function parseContent(
  event: RelayEvent,
  expectedKind: number,
  expectedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (event.kind !== expectedKind || !Number.isSafeInteger(event.created_at)) {
    throw new BusinessRecordParseError(
      "money record event metadata is invalid",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    throw new BusinessRecordParseError("money record content is invalid JSON");
  }
  if (!isRecord(parsed)) {
    throw new BusinessRecordParseError(
      "money record content must be an object",
    );
  }
  const actualKeys = Object.keys(parsed).sort();
  const allowedKeys = new Set([...expectedKeys, ...optionalKeys]);
  if (
    expectedKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new BusinessRecordParseError("money record fields are invalid");
  }
  return parsed;
}

function validateCoordinates(
  event: RelayEvent,
  clientId: string,
  dTag: string,
) {
  const hTags = event.tags.filter((tag) => tag[0] === "h");
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (
    event.tags.length !== 2 ||
    hTags.length !== 1 ||
    hTags[0]?.length !== 2 ||
    dTags.length !== 1 ||
    dTags[0]?.length !== 2 ||
    hTags[0]?.[1]?.toLowerCase() !== clientId ||
    dTags[0]?.[1] !== dTag
  ) {
    throw new BusinessRecordParseError("money record scope tags are invalid");
  }
}

function readLines(
  record: Record<string, unknown>,
  key: string,
): InvoiceLine[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new BusinessRecordParseError(
      `money record ${key} must contain lines`,
    );
  }
  return value.map((line) => {
    if (
      !isRecord(line) ||
      Object.keys(line).sort().join(",") !==
        ["description", "quantityHundredths", "serviceId", "unitAmountMinor"]
          .sort()
          .join(",")
    ) {
      throw new BusinessRecordParseError("invoice line fields are invalid");
    }
    return {
      serviceId:
        line.serviceId === null
          ? null
          : validateUuid(line.serviceId, "serviceId"),
      description: readNonEmptyString(line, "description"),
      quantityHundredths: readInteger(line, "quantityHundredths", 1),
      unitAmountMinor: readInteger(line, "unitAmountMinor", 0),
    };
  });
}

function readTaxLines(
  record: Record<string, unknown>,
  key: string,
): InvoiceTaxLine[] {
  const value = record[key] ?? [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new BusinessRecordParseError(
      `money record ${key} must contain no more than 100 tax lines`,
    );
  }
  return value.map((taxLine) => {
    if (
      !isRecord(taxLine) ||
      Object.keys(taxLine).sort().join(",") !== "label,rateBasisPoints"
    ) {
      throw new BusinessRecordParseError("invoice tax line fields are invalid");
    }
    const label = readOptionalNonEmptyString(taxLine, "label", 200);
    const rateBasisPoints = readInteger(taxLine, "rateBasisPoints", 0);
    if (rateBasisPoints > 4_294_967_295) {
      throw new BusinessRecordParseError("invoice tax rate is invalid");
    }
    return { label, rateBasisPoints };
  });
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new BusinessRecordParseError(`money record ${key} must be a string`);
  }
  return value;
}

function readNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = readString(record, key);
  if (!value.trim())
    throw new BusinessRecordParseError(`money record ${key} is empty`);
  return value;
}

function readOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  maxBytes: number,
): string | null {
  if (record[key] === undefined || record[key] === null) return null;
  const value = readNonEmptyString(record, key);
  if (new TextEncoder().encode(value).length > maxBytes) {
    throw new BusinessRecordParseError(`money record ${key} is too long`);
  }
  return value;
}

function readUuid(record: Record<string, unknown>, key: string): string {
  return validateUuid(record[key], key);
}

function validateUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BusinessRecordParseError(`money record ${label} is not a UUID`);
  }
  return value.toLowerCase();
}

function canonicalUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`${label} must be a UUID`);
  return value.toLowerCase();
}

function readHex(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (!HEX_32_RE.test(value))
    throw new BusinessRecordParseError(`money record ${key} is invalid`);
  return value;
}

function readNullableHex(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return record[key] === null ? null : readHex(record, key);
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return record[key] === null ? null : readString(record, key);
}

function readNullableInteger(
  record: Record<string, unknown>,
  key: string,
): number | null {
  return record[key] === null ? null : readInteger(record, key, 0);
}

function readInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new BusinessRecordParseError(
      `money record ${key} is not a safe integer`,
    );
  }
  return value as number;
}

function readCurrency(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new BusinessRecordParseError(
      `money record ${key} is not an ISO currency code`,
    );
  }
  return value;
}

function readEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] {
  const value = readString(record, key);
  if (!allowed.includes(value))
    throw new BusinessRecordParseError(`money record ${key} is invalid`);
  return value as T[number];
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new BusinessRecordParseError(`money record ${key} must be a boolean`);
  }
  return value;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value))
    throw new Error(`${label} must be a safe integer`);
}

function addAmount(
  target: Record<string, number>,
  currency: string,
  amount: number,
) {
  const next = (target[currency] ?? 0) + amount;
  assertSafeInteger(next, "money total");
  target[currency] = next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
