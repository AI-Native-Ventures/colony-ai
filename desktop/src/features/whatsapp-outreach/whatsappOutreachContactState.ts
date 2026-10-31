import type {
  WhatsAppBatchDetail,
  WhatsAppBatchRow,
  WhatsAppContact,
} from "./whatsappOutreachModels";

export type PendingBatchRow = Readonly<{
  batch: WhatsAppBatchDetail;
  row: WhatsAppBatchRow;
}>;

export function contactStatus(
  contact: WhatsAppContact,
  waitingForApproval = false,
): string {
  if (contact.optedOut) return "Opted out";
  if (waitingForApproval || contact.awaitingApproval) {
    return "Waiting for your approval";
  }
  if (contact.unanswered) return "Replied";
  if (contact.lastInboundAt) return "Replied";
  return "Sent";
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
