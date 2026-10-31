import type { BusinessRecords } from "@/features/discovery/businessRecordRelay";
import type { CustomerRecordView } from "@/features/cofounder/customerRecords";
import {
  formatWhatsAppNumber,
  type WhatsAppContact,
} from "./whatsappOutreachModels";

export type OutreachContactIdentity = Readonly<{
  displayName: string;
  businessName: string | null;
  personName: string | null;
  location: string | null;
  website: string | null;
  phone: string;
  partyId: string | null;
  leadId: string | null;
  isLinked: boolean;
}>;

export function resolveOutreachContactIdentity(
  contact: WhatsAppContact,
  businessRecords: BusinessRecords | null | undefined,
): OutreachContactIdentity {
  const lead = contact.leadId
    ? businessRecords?.prospects.find(
        ({ record }) => record.prospectId === contact.leadId,
      )?.record.prospect
    : undefined;
  const linkedBusinessName = lead?.party.displayName ?? contact.businessName;
  const isLinked = Boolean(lead || contact.businessName?.trim());
  const displayName =
    contact.label?.trim() ||
    (isLinked
      ? linkedBusinessName || contact.displayName || "WhatsApp contact"
      : formatWhatsAppNumber(contact.e164));
  return {
    displayName,
    businessName: linkedBusinessName ?? null,
    personName: lead?.contactName ?? contact.profileName ?? contact.displayName,
    location: lead?.location ?? null,
    website: lead?.website ?? contact.website,
    phone: formatWhatsAppNumber(contact.e164),
    partyId: lead?.party.partyId ?? null,
    leadId: contact.leadId,
    isLinked,
  };
}

export function customerRecordForContact(
  contact: WhatsAppContact,
  identity: OutreachContactIdentity,
  records: readonly CustomerRecordView[],
): CustomerRecordView | null {
  const matchedByParty = identity.partyId
    ? records.find((record) => record.partyId === identity.partyId)
    : null;
  if (matchedByParty) return matchedByParty;
  return contact.leadId
    ? (records.find((record) => record.leadId === contact.leadId) ?? null)
    : null;
}

export function customerRecordNextStep(
  record: CustomerRecordView | null,
): string | null {
  const entry = record?.timeline.at(-1);
  if (!entry) return null;
  return entry.title || entry.detail || null;
}
