import type {
  WhatsAppContact,
  WhatsAppTemplate,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";
import {
  outreachNotContactedReason,
  type OutreachFitScore,
  type OutreachNotContactedReason,
} from "./outreachFitScore";

export type OutreachBatchLead = {
  leadId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  whatsappPhone?: string | null;
  /** Undefined preserves the existing batch behavior for older callers. */
  fit?: OutreachFitScore | null;
};

export type OutreachBatchContent = {
  v: 1;
  batchId: string;
  template: string;
  language: string;
  rows: Array<{
    to: string;
    leadId: string;
    name: string;
    params: string[];
  }>;
  materialLinks: string[];
  note: string;
};

export type OutreachBatchPlan = {
  content: OutreachBatchContent;
  skipped: Record<
    | "noPhone"
    | "notOnWhatsApp"
    | "optedOut"
    | "paused"
    | "inBatch"
    | "alreadyContacted"
    | "invalidPhone"
    | "duplicate",
    number
  >;
  notContacted: Array<{
    leadId: string;
    name: string;
    reason: OutreachNotContactedReason;
  }>;
};

export function normalizeOutreachPhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("27")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `+27${digits.slice(1)}`;
  }
  return null;
}

export function buildOutreachBatchPlan(input: {
  batchId: string;
  listName: string;
  leads: readonly OutreachBatchLead[];
  contacts: readonly WhatsAppContact[];
  inBatchLeadIds: ReadonlySet<string>;
  template: WhatsAppTemplate;
  /** Null means the default-off setting does not filter on fit. */
  minimumFit?: number | null;
}): OutreachBatchPlan {
  const skipped = {
    noPhone: 0,
    notOnWhatsApp: 0,
    optedOut: 0,
    paused: 0,
    inBatch: 0,
    alreadyContacted: 0,
    invalidPhone: 0,
    duplicate: 0,
  };
  const seenNumbers = new Set<string>();
  const rows: OutreachBatchContent["rows"] = [];
  const notContacted: OutreachBatchPlan["notContacted"] = [];
  for (const lead of input.leads) {
    const contact = input.contacts.find((item) => item.leadId === lead.leadId);
    const targetPhone =
      lead.whatsappPhone?.trim() || lead.phone?.trim() || contact?.e164 || "";
    if (lead.fit !== undefined) {
      const reason = outreachNotContactedReason({
        fit: lead.fit,
        hasWhatsAppNumber: Boolean(targetPhone.trim()),
        minimumFit: input.minimumFit,
      });
      if (reason) {
        notContacted.push({
          leadId: lead.leadId,
          name: lead.name,
          reason,
        });
        if (reason.code === "no_whatsapp_number") skipped.noPhone += 1;
        continue;
      }
    }
    if (!targetPhone.trim()) {
      skipped.noPhone += 1;
      continue;
    }
    if (contact?.stage === "not_on_whatsapp") {
      skipped.notOnWhatsApp += 1;
      continue;
    }
    if (contact?.optedOut) {
      skipped.optedOut += 1;
      continue;
    }
    if (contact?.paused) {
      skipped.paused += 1;
      continue;
    }
    if (input.inBatchLeadIds.has(lead.leadId)) {
      skipped.inBatch += 1;
      continue;
    }
    if (contact?.lastContactedAt && !contact.lastInboundAt) {
      skipped.alreadyContacted += 1;
      continue;
    }
    const to = normalizeOutreachPhone(targetPhone);
    if (!to) {
      skipped.invalidPhone += 1;
      continue;
    }
    if (seenNumbers.has(to)) {
      skipped.duplicate += 1;
      continue;
    }
    seenNumbers.add(to);
    rows.push({
      to,
      leadId: lead.leadId,
      name: lead.contactName ?? lead.name,
      params: Array.from({ length: input.template.slots }, (_, index) =>
        index === 0 ? (lead.contactName ?? lead.name) : "",
      ),
    });
  }
  return {
    content: {
      v: 1,
      batchId: input.batchId,
      template: input.template.name,
      language: input.template.language,
      rows,
      materialLinks: [],
      note: `List ${input.listName}.`,
    },
    skipped,
    notContacted,
  };
}
