import {
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import type { WhatsAppContact } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import { outreachNotContactedReason } from "./outreachFitScore";

export type OutreachListProgressMember = Readonly<{
  active: boolean;
  leadId: string;
  phone: string | null;
  whatsappPhone: string | null;
}>;

export type OutreachListProgress = Readonly<{
  impossible: number;
  messaged: number;
  resolved: number;
  total: number;
}>;

function hasRecordedFirstMessageAttempt(contact: WhatsAppContact): boolean {
  return Boolean(
    contact.hasSentOutbound ||
      contact.lastContactedAt ||
      contact.lastInboundAt ||
      contact.lastOutboundState ||
      contact.lastReplyAt,
  );
}

/**
 * A first message counts after an actual WhatsApp attempt, whatever its outcome.
 * A queued row is deliberately excluded until that attempt is recorded.
 */
export function hasAttemptedWhatsAppFirstMessage(
  contact: WhatsAppContact | null,
  inBatch: boolean,
): boolean {
  if (!contact) return false;
  if (hasRecordedFirstMessageAttempt(contact)) return true;
  if (contact.stage === "not_on_whatsapp") return true;
  if (contact.stage === "queued") return false;
  const status = getWhatsAppLeadStatus(contact, inBatch);
  return status === "sent" || status === "replied";
}

function memberCannotReceiveFirstMessage(input: {
  active: boolean;
  contact: WhatsAppContact | null;
  phone: string | null;
  whatsappPhone: string | null;
}): boolean {
  if (!input.active) return true;
  if (
    input.contact?.stage === "not_on_whatsapp" ||
    input.contact?.optedOut ||
    input.contact?.businessOutreachStopped
  ) {
    return true;
  }
  const phone =
    input.whatsappPhone?.trim() || input.phone?.trim() || input.contact?.e164;
  return (
    outreachNotContactedReason({
      fit: null,
      hasWhatsAppNumber: Boolean(phone?.trim()),
      minimumFit: null,
    }) !== null
  );
}

/**
 * One list summary, shared by the Lists overview, filters, and detail header.
 * This is display-only and never changes the persisted list record.
 */
export function calculateOutreachListProgress(input: {
  contacts: readonly WhatsAppContact[];
  inBatchLeadIds: ReadonlySet<string>;
  members: readonly OutreachListProgressMember[];
}): OutreachListProgress {
  let messaged = 0;
  let impossible = 0;
  let resolved = 0;
  for (const member of input.members) {
    const contact = findWhatsAppContactForLead(member.leadId, input.contacts);
    const attempted = hasAttemptedWhatsAppFirstMessage(
      contact,
      input.inBatchLeadIds.has(member.leadId),
    );
    const unavailable = memberCannotReceiveFirstMessage({
      active: member.active,
      contact,
      phone: member.phone,
      whatsappPhone: member.whatsappPhone,
    });
    if (attempted) messaged += 1;
    if (unavailable) impossible += 1;
    if (attempted || unavailable) resolved += 1;
  }
  return {
    impossible,
    messaged,
    resolved,
    total: input.members.length,
  };
}
