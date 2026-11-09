import type {
  WhatsAppBatchDetail,
  WhatsAppBatchRow,
  WhatsAppContact,
} from "./whatsappOutreachModels";
import type { WhatsAppSuppression } from "./whatsappOutreachSafety";

export type PendingBatchRow = Readonly<{
  batch: WhatsAppBatchDetail;
  row: WhatsAppBatchRow;
}>;

export function contactStatus(
  contact: WhatsAppContact,
  waitingForApproval = false,
): string {
  if (contact.optedOut) return "Opted out";
  if (contact.deliveryFailure) return "Not delivered";
  if (contact.lastOutboundState === "failed") return "Send failed";
  if (contact.stage === "queued") return "Queued";
  if (waitingForApproval || contact.awaitingApproval) {
    return "Waiting for your approval";
  }
  if (contact.unanswered) return "Replied";
  if (contact.lastInboundAt) return "Replied";
  return "Sent";
}

/**
 * A sent outreach contact whose latest known inbound message has already been answered, or which
 * has never replied. This stays conservative when talking to an older relay without the new flag.
 */
export function isWhatsAppAwaitingReply(contact: WhatsAppContact): boolean {
  if (
    contact.optedOut ||
    contact.businessOutreachStopped ||
    contact.unanswered ||
    contact.awaitingApproval ||
    contact.stage === "queued"
  ) {
    return false;
  }
  const hasOutbound =
    contact.hasSentOutbound ||
    contact.lastOutboundState !== null ||
    contact.lastContactedAt !== null;
  if (!hasOutbound) return false;
  if (!contact.lastInboundAt) return true;
  if (!contact.lastContactedAt) return false;
  const inboundAt = Date.parse(contact.lastInboundAt);
  const outboundAt = Date.parse(contact.lastContactedAt);
  return Number.isFinite(inboundAt) && Number.isFinite(outboundAt)
    ? outboundAt > inboundAt
    : false;
}

export function normalizeWhatsAppSafetyPhone(value: string): string {
  return value.replace(/\D/gu, "");
}

export function optOutSuppressionsByWaId(
  suppressions: readonly WhatsAppSuppression[],
): ReadonlyMap<string, WhatsAppSuppression> {
  return new Map(
    suppressions
      .filter(
        (suppression) =>
          suppression.scope === "opt_out" &&
          suppression.identityKind === "phone",
      )
      .map((suppression) => [
        normalizeWhatsAppSafetyPhone(suppression.identityValue),
        suppression,
      ]),
  );
}

/**
 * Combines the list view with a just-fetched thread, retaining list data when
 * a relay version does not include an additive thread field.
 */
export function contactWithThreadDetails(
  contact: WhatsAppContact | null,
  threadContact: WhatsAppContact | undefined,
  pendingBatchLeadId: string | null | undefined,
): WhatsAppContact | null {
  if (!contact) return null;
  return {
    ...contact,
    displayName: contact.displayName ?? threadContact?.displayName ?? null,
    profileName: contact.profileName ?? threadContact?.profileName ?? null,
    businessName: contact.businessName ?? threadContact?.businessName ?? null,
    website: contact.website ?? threadContact?.website ?? null,
    label: contact.label ?? threadContact?.label ?? null,
    stage: contact.stage ?? threadContact?.stage ?? "none",
    stageSetBy: contact.stageSetBy ?? threadContact?.stageSetBy ?? null,
    stageChangedAt:
      contact.stageChangedAt ?? threadContact?.stageChangedAt ?? null,
    queuedFrom: contact.queuedFrom ?? threadContact?.queuedFrom ?? null,
    outreachStatus:
      contact.outreachStatus ?? threadContact?.outreachStatus ?? null,
    lastContactedAt:
      contact.lastContactedAt ?? threadContact?.lastContactedAt ?? null,
    lastOutboundState:
      contact.lastOutboundState ?? threadContact?.lastOutboundState ?? null,
    lastFailureSummary:
      contact.lastFailureSummary ?? threadContact?.lastFailureSummary ?? null,
    deliveryFailure:
      contact.deliveryFailure ?? threadContact?.deliveryFailure ?? null,
    lastReplyAt: contact.lastReplyAt ?? threadContact?.lastReplyAt ?? null,
    hasSentOutbound:
      contact.hasSentOutbound || threadContact?.hasSentOutbound === true,
    businessOutreachStopped:
      contact.businessOutreachStopped ||
      threadContact?.businessOutreachStopped === true,
    businessStopReason:
      contact.businessStopReason ?? threadContact?.businessStopReason ?? null,
    leadId:
      contact.leadId ?? threadContact?.leadId ?? pendingBatchLeadId ?? null,
  };
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/gu, "");
}

export function pendingBatchRowsForContact(
  contact: WhatsAppContact,
  batches: readonly WhatsAppBatchDetail[],
): PendingBatchRow[] {
  const contactPhone = normalizedPhone(contact.e164 || contact.waId);
  return batches
    .filter((batch) => batch.status === "pending")
    .flatMap((batch) =>
      batch.rows
        .filter(
          (row) =>
            normalizedPhone(row.to) === contactPhone &&
            !["dropped", "skipped", "failed"].includes(
              row.state.toLocaleLowerCase(),
            ),
        )
        .map((row) => ({ batch, row })),
    );
}

export function uniquePendingBatchRowForContact(
  contact: WhatsAppContact,
  batches: readonly WhatsAppBatchDetail[],
): PendingBatchRow | null {
  const rows = pendingBatchRowsForContact(contact, batches);
  return rows.length === 1 ? rows[0] : null;
}

export function sendNowBatchIdForQueuedMessage(
  contact: WhatsAppContact,
  messageText: string,
  batches: readonly WhatsAppBatchDetail[],
  messageSendsAt?: string | null,
): string | null {
  const contactPhone = normalizedPhone(contact.e164 || contact.waId);
  if (!contactPhone) return null;

  const matches = batches.flatMap((batch) => {
    if (batch.status !== "approved" || batch.rows.length > 3) return [];
    return batch.rows
      .filter(
        (row) =>
          row.state === "ready" &&
          normalizedPhone(row.to) === contactPhone &&
          row.preview === messageText &&
          (messageSendsAt == null ||
            (row.sendsAt != null &&
              Date.parse(row.sendsAt) === Date.parse(messageSendsAt))),
      )
      .map(() => batch.batchId);
  });
  return matches.length === 1 ? matches[0] : null;
}
