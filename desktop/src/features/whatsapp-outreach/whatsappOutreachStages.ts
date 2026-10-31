import {
  formatWhatsAppNumber,
  type WhatsAppContact,
  type WhatsAppStage,
} from "./whatsappOutreachModels";

export const WHATSAPP_PIPELINE_STAGES = [
  "contacted",
  "replied",
  "wants_call",
  "call_booked",
  "quote_sent",
  "client",
] as const satisfies readonly WhatsAppStage[];

export const WHATSAPP_MANUAL_STAGES = [
  ...WHATSAPP_PIPELINE_STAGES,
  "no_thanks",
] as const satisfies readonly WhatsAppStage[];

export const WHATSAPP_STAGE_LABELS: Record<WhatsAppStage, string> = {
  none: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
  wants_call: "Wants a call",
  call_booked: "Call booked",
  quote_sent: "Quote sent",
  client: "Client",
  no_thanks: "No thanks",
  stopped: "Stopped",
  not_on_whatsapp: "Not on WhatsApp",
};

export type WhatsAppNeedsYouItem = Readonly<{
  contact: WhatsAppContact;
  section: "wants-call" | "waiting-for-reply";
  hasDraft: boolean;
}>;

/** Returns each contact once, with wants-call taking priority over replies. */
export function getWhatsAppNeedsYouItems(
  contacts: readonly WhatsAppContact[],
  drafts: readonly { waId: string }[],
): WhatsAppNeedsYouItem[] {
  const draftIds = new Set(drafts.map((draft) => draft.waId));
  const itemByWaId = new Map<string, WhatsAppNeedsYouItem>();
  for (const contact of contacts) {
    const hasDraft = draftIds.has(contact.waId);
    let item: WhatsAppNeedsYouItem | null = null;
    if (contact.stage === "wants_call") {
      item = { contact, section: "wants-call", hasDraft };
    } else if (contact.unanswered || hasDraft) {
      item = { contact, section: "waiting-for-reply", hasDraft };
    }
    if (!item) continue;
    const itemKey = `${contact.waId}:${item.section}`;
    const existing = itemByWaId.get(itemKey);
    if (!existing || item.section === "wants-call") {
      itemByWaId.set(itemKey, item);
    }
  }
  const items = [...itemByWaId.values()];
  return items.sort((left, right) => {
    if (left.section !== right.section) {
      return left.section === "wants-call" ? -1 : 1;
    }
    const leftAt = Date.parse(
      left.contact.lastReplyAt ?? left.contact.lastInboundAt ?? "",
    );
    const rightAt = Date.parse(
      right.contact.lastReplyAt ?? right.contact.lastInboundAt ?? "",
    );
    return (
      (Number.isFinite(rightAt) ? rightAt : 0) -
      (Number.isFinite(leftAt) ? leftAt : 0)
    );
  });
}

export function contactDisplayName(contact: WhatsAppContact): string {
  return (
    contact.label?.trim() ||
    contact.businessName?.trim() ||
    contact.displayName?.trim() ||
    contact.profileName?.trim() ||
    formatWhatsAppNumber(contact.e164)
  );
}

export function isWhatsAppPipelineStage(
  stage: WhatsAppStage,
): stage is (typeof WHATSAPP_PIPELINE_STAGES)[number] {
  return (WHATSAPP_PIPELINE_STAGES as readonly WhatsAppStage[]).includes(stage);
}
