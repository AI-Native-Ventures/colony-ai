import {
  findWhatsAppContactForLead,
  getWhatsAppLeadStatus,
} from "@/features/whatsapp-outreach/whatsappLeadStatus";
import {
  whatsappLeadStatusLabel,
  type WhatsAppContact,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";
import type { LeadContext } from "./leadShared";

export function sourceLabel(
  source: LeadContext["records"]["outreachLists"][number]["record"]["source"],
  campaignNames: ReadonlyMap<string, string>,
): string {
  if (source.kind === "campaign") {
    return source.campaignId
      ? (campaignNames.get(source.campaignId) ?? "Discovery campaign")
      : "Discovery campaign";
  }
  return source.kind === "agent" ? "Created by Scout" : "Created by a person";
}

export function stageLabel(
  prospect: LeadContext["records"]["prospects"][number]["record"]["prospect"],
): string {
  if (prospect.qualification === "unreviewed") return "New";
  switch (prospect.stage) {
    case "in_conversation":
      return "In conversation";
    case "qualified":
      return "Qualified";
    case "proposal":
      return "Proposal";
    case "won":
      return "Won";
    case "lost":
      return "Lost";
  }
}

export function statusLabel(
  leadId: string,
  phone: string | null,
  contacts: readonly WhatsAppContact[] | undefined,
  inBatchLeadIds: ReadonlySet<string>,
): string {
  const contact = findWhatsAppContactForLead(leadId, contacts ?? []);
  if (contact?.stage === "not_on_whatsapp") return "No WhatsApp";
  if (!phone && !contact?.e164) return "No phone number";
  const leadStatus = getWhatsAppLeadStatus(contact, inBatchLeadIds.has(leadId));
  if (leadStatus === "opted-out") return whatsappLeadStatusLabel(leadStatus);
  if (leadStatus === "replied" || contact?.stage === "replied") {
    return "Replied";
  }
  if (leadStatus === "in-batch") return whatsappLeadStatusLabel(leadStatus);
  switch (contact?.lastOutboundState) {
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "failed":
      return "Failed";
    case "sent":
      return "Sent";
  }
  return contact?.lastContactedAt ? "Sent" : "Not contacted";
}

export function contactedAtLabel(value: string): string {
  const date = new Date(value);
  const dayKey = (candidate: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Africa/Johannesburg",
      year: "numeric",
    }).format(candidate);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) {
    return `Today ${new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: "Africa/Johannesburg",
    }).format(date)}`;
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}
