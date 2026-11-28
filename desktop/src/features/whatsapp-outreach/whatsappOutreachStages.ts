import { contactAwaitsCallFrom } from "./whatsappCallBrief";
import {
  formatWhatsAppNumber,
  type WhatsAppContact,
  type WhatsAppStage,
  type WhatsAppStageCounts,
} from "./whatsappOutreachModels";

export const WHATSAPP_PIPELINE_STAGES = [
  "queued",
  "contacted",
  "replied",
  "wants_call",
  "ready_to_call",
  "call_booked",
  "quote_sent",
  "client",
] as const satisfies readonly WhatsAppStage[];

export const WHATSAPP_MANUAL_STAGES = [
  // Queue membership is derived by the relay and is never a manual target.
  "contacted",
  "replied",
  "wants_call",
  "ready_to_call",
  "call_booked",
  "quote_sent",
  "client",
  "no_thanks",
] as const satisfies readonly WhatsAppStage[];

export const WHATSAPP_STAGE_LABELS: Record<WhatsAppStage, string> = {
  none: "Not contacted",
  queued: "Queued to contact",
  contacted: "Contacted",
  replied: "Replied",
  wants_call: "Wants a call",
  ready_to_call: "Ready to call",
  call_booked: "Call booked",
  quote_sent: "Quote sent",
  client: "Client",
  no_thanks: "No thanks",
  stopped: "Stopped",
  not_on_whatsapp: "Not on WhatsApp",
};

export type WhatsAppNeedsYouSection =
  | "ready-to-call"
  | "wants-call"
  | "waiting-for-reply";

export type WhatsAppNeedsYouItem = Readonly<{
  contact: WhatsAppContact;
  section: WhatsAppNeedsYouSection;
  hasDraft: boolean;
}>;

/** A call to make comes before a call to prepare, and both before a reply to write. */
const NEEDS_YOU_SECTION_ORDER: Record<WhatsAppNeedsYouSection, number> = {
  "ready-to-call": 0,
  "wants-call": 1,
  "waiting-for-reply": 2,
};

/**
 * Returns each contact once, with a call taking priority over a reply. A lead that is ready
 * to call needs the person it was given to (`myPubkey`), or whoever looks while nobody has
 * it. Given to someone else, it only needs this person when there is a reply to write.
 */
export function getWhatsAppNeedsYouItems(
  contacts: readonly WhatsAppContact[],
  drafts: readonly { waId: string }[],
  myPubkey?: string | null,
): WhatsAppNeedsYouItem[] {
  const draftIds = new Set(drafts.map((draft) => draft.waId));
  const itemByWaId = new Map<string, WhatsAppNeedsYouItem>();
  for (const contact of contacts) {
    if (contact.stage === "queued") continue;
    const hasDraft = draftIds.has(contact.waId);
    let item: WhatsAppNeedsYouItem | null = null;
    if (contact.stage === "wants_call") {
      item = { contact, section: "wants-call", hasDraft };
    } else if (
      contact.stage === "ready_to_call" &&
      contactAwaitsCallFrom(contact, myPubkey)
    ) {
      item = { contact, section: "ready-to-call", hasDraft };
    } else if (contact.unanswered || hasDraft) {
      item = { contact, section: "waiting-for-reply", hasDraft };
    }
    if (!item) continue;
    const existing = itemByWaId.get(contact.waId);
    if (
      !existing ||
      NEEDS_YOU_SECTION_ORDER[item.section] <
        NEEDS_YOU_SECTION_ORDER[existing.section]
    ) {
      itemByWaId.set(contact.waId, item);
    }
  }
  const items = [...itemByWaId.values()];
  return items.sort((left, right) => {
    if (left.section !== right.section) {
      return (
        NEEDS_YOU_SECTION_ORDER[left.section] -
        NEEDS_YOU_SECTION_ORDER[right.section]
      );
    }
    // A call given to this person comes before one nobody has yet.
    const leftOpen = left.contact.callBrief?.assigneePubkey ? 0 : 1;
    const rightOpen = right.contact.callBrief?.assigneePubkey ? 0 : 1;
    if (left.section === "ready-to-call" && leftOpen !== rightOpen) {
      return leftOpen - rightOpen;
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

/**
 * The number a Pipeline column or pile shows. While searching it is the matching loaded
 * contacts. Otherwise it is the relay's true count over every contact, which the loaded list
 * may not hold in full; `contacted` also takes the contacts that never reached anyone, as the
 * Contacted column lists them. Without counts (an older relay, still loading, or failed) it
 * falls back to the loaded contacts of the stage.
 */
export function pipelineStageTotal(input: {
  stage: WhatsAppStage;
  loadedCount: number;
  searching: boolean;
  counts: WhatsAppStageCounts | null | undefined;
}): number {
  const { stage, loadedCount, searching, counts } = input;
  if (searching || !counts) return loadedCount;
  const counted = counts.stageCounts[stage] ?? 0;
  return stage === "contacted" ? counted + counts.failedNotContacted : counted;
}
