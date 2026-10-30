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
