import type { CapabilityGapHead, GapNeedsYouItem } from "../../accessRecords";
import { buildGapNeedsYouItems } from "../../accessRecords";
import { capabilityGapFunctionId } from "../../needsYouSummary";
import type { FunctionId } from "../../cofounderRecords";
import { FUNCTION_DETAILS } from "../../functions";
import type {
  NeedsYouItem,
  NeedsYouModel,
  NeedsYouDetail,
} from "../../needsYou";
import { moneyLabel, type MoneyLinkCard } from "../../moneyRails";
import type {
  WhatsAppContact,
  WhatsAppDraft,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";

export type NeedsYouRow =
  | { kind: "item"; id: string; item: NeedsYouItem }
  | {
      kind: "draft";
      id: string;
      item: NeedsYouItem;
      detail: NeedsYouDetail;
      draft: WhatsAppDraft | null;
      contact: WhatsAppContact | null;
    }
  | { kind: "payment_link"; id: string; card: MoneyLinkCard }
  | {
      kind: "capability_gap";
      id: string;
      item: GapNeedsYouItem;
      functionId: FunctionId | null;
    }
  | { kind: "call_request"; id: string; contact: WhatsAppContact };

export type NeedsYouGroup = {
  functionId: FunctionId | null;
  label: string;
  rows: NeedsYouRow[];
};

const NEEDS_YOU_FUNCTION_ORDER: FunctionId[] = [
  "sales",
  "operations",
  "finance",
  "customer_success",
  "brand",
];

export type NeedsYouRowCopy = {
  title: string;
  subtitle: string;
  yesLabel: string;
  noLabel: "No" | null;
};

export type NeedsYouActionCommand =
  | { kind: "open"; row: NeedsYouRow }
  | {
      kind: "payment_link";
      card: MoneyLinkCard;
      decision: "approve" | "reject";
    }
  | {
      kind: "capability_gap";
      item: GapNeedsYouItem;
      operation: "gap_approve" | "gap_decline" | "gap_done" | "open_page";
    }
  | { kind: "whatsapp_batch"; batchId: string; decision: "approve" | "reject" }
  | { kind: "whatsapp_draft"; draftId: string; decision: "approve" | "reject" }
  | {
      kind: "plan";
      planId: string;
      stepId: string | null;
      operation: "approve" | "reject" | "done";
    }
  | { kind: "playbook"; playbookId: string; decision: "approve" | "reject" }
  | {
      kind: "playbook_job";
      jobId: string;
      stepId: string;
      operation: "approve" | "reject" | "done";
    }
  | { kind: "goal"; goalId: string; decision: "approve" | "reject" }
  | {
      kind: "review_decision";
      reviewDate: string;
      decisionId: string;
      decision: "approved" | "declined";
    };

/** Maps each row button to the existing product operation it represents. */
export function describeNeedsYouAction(
  row: NeedsYouRow,
  decision: "yes" | "no",
): NeedsYouActionCommand | null {
  const approve = decision === "yes";
  if (row.kind === "payment_link") {
    return {
      kind: "payment_link",
      card: row.card,
      decision: approve ? "approve" : "reject",
    };
  }
  if (row.kind === "capability_gap") {
    const operation =
      row.item.group === "approve"
        ? approve
          ? "gap_approve"
          : "gap_decline"
        : approve
          ? "gap_done"
          : null;
    if (!operation) return null;
    return { kind: "capability_gap", item: row.item, operation };
  }
  if (row.kind === "call_request") {
    return approve ? { kind: "open", row } : null;
  }
  if (row.kind === "draft") {
    return {
      kind: "whatsapp_draft",
      draftId: row.detail.id,
      decision: approve ? "approve" : "reject",
    };
  }

  const item = row.item;
  switch (item.source.kind) {
    case "plan":
      return {
        kind: "plan",
        planId: item.source.planId,
        stepId: item.source.stepId,
        operation:
          item.section === "do" ? "done" : approve ? "approve" : "reject",
      };
    case "playbook":
      return {
        kind: "playbook",
        playbookId: item.source.playbookId,
        decision: approve ? "approve" : "reject",
      };
    case "playbook_job":
      return {
        kind: "playbook_job",
        jobId: item.source.jobId,
        stepId: item.source.stepId,
        operation:
          item.section === "do" ? "done" : approve ? "approve" : "reject",
      };
    case "goal":
      return {
        kind: "goal",
        goalId: item.source.goalId,
        decision: approve ? "approve" : "reject",
      };
    case "review_decision":
      return {
        kind: "review_decision",
        reviewDate: item.source.reviewDate,
        decisionId: item.source.decisionId,
        decision: approve ? "approved" : "declined",
      };
    case "whatsapp_batch":
      return {
        kind: "whatsapp_batch",
        batchId: item.source.batchId,
        decision: approve ? "approve" : "reject",
      };
    case "ask":
      return approve ? { kind: "open", row } : null;
    case "whatsapp_drafts":
      return null;
  }
}

export function buildNeedsYouRows(input: {
  model: NeedsYouModel;
  paymentLinks: readonly MoneyLinkCard[];
  capabilityGaps: readonly GapNeedsYouItem[];
  capabilityGapHeads: readonly CapabilityGapHead[];
  whatsappContacts: readonly WhatsAppContact[];
  whatsappDrafts: readonly WhatsAppDraft[];
}): NeedsYouRow[] {
  const contacts = new Map(
    input.whatsappContacts.map((contact) => [contact.waId, contact]),
  );
  const drafts = new Map(
    input.whatsappDrafts.map((draft) => [draft.id, draft]),
  );
  const rows = [
    ...input.model.approve,
    ...input.model.do,
    ...input.model.decide,
  ].flatMap<NeedsYouRow>((item) => {
    if (item.source.kind !== "whatsapp_drafts") {
      return [{ kind: "item", id: item.id, item }];
    }
    return item.details.map((detail) => {
      const draft = drafts.get(detail.id) ?? null;
      return {
        kind: "draft" as const,
        id: `draft:${detail.id}`,
        item,
        detail,
        draft,
        contact: draft ? (contacts.get(draft.waId) ?? null) : null,
      };
    });
  });

  rows.push(
    ...input.paymentLinks
      .filter((card) => card.state === "needs_you")
      .map((card) => ({
        kind: "payment_link" as const,
        id: `payment-link:${card.id}`,
        card,
      })),
  );

  const visibleGapIds = new Set(
    buildGapNeedsYouItems(input.capabilityGapHeads).map((item) => item.gapId),
  );
  const gapPartById = new Map(
    input.capabilityGapHeads.map((head) => [
      head.gapId,
      capabilityGapFunctionId(head),
    ]),
  );
  rows.push(
    ...input.capabilityGaps
      .filter((item) => visibleGapIds.has(item.gapId))
      .map((item) => ({
        kind: "capability_gap" as const,
        id: `capability-gap:${item.gapId}`,
        item,
        functionId: gapPartById.get(item.gapId) ?? null,
      })),
  );

  const seenCallIds = new Set<string>();
  for (const contact of input.whatsappContacts) {
    if (contact.stage !== "wants_call" || seenCallIds.has(contact.waId))
      continue;
    seenCallIds.add(contact.waId);
    rows.push({
      kind: "call_request",
      id: `call:${contact.waId}`,
      contact,
    });
  }

  return rows;
}

export function needsYouRowFunctionId(row: NeedsYouRow): FunctionId | null {
  switch (row.kind) {
    case "item":
    case "draft":
      return row.item.functionId;
    case "payment_link":
      return "finance";
    case "capability_gap":
      return row.functionId;
    case "call_request":
      return "sales";
  }
}

export function groupNeedsYouRows(
  rows: readonly NeedsYouRow[],
): NeedsYouGroup[] {
  const byPart = new Map<string, NeedsYouRow[]>();
  for (const row of rows) {
    const key = needsYouRowFunctionId(row) ?? "company";
    byPart.set(key, [...(byPart.get(key) ?? []), row]);
  }

  return [...NEEDS_YOU_FUNCTION_ORDER, null].flatMap((functionId) => {
    const key = functionId ?? "company";
    const groupRows = byPart.get(key) ?? [];
    if (groupRows.length === 0) return [];
    const label = functionId ? FUNCTION_DETAILS[functionId].name : "Company";
    return [{ functionId, label, rows: groupRows }];
  });
}

function contactName(
  contact: WhatsAppContact | null,
  fallback: string,
): string {
  if (!contact) return fallback.trim() || "Contact";
  const person = contact.displayName?.trim() || contact.profileName?.trim();
  const business = contact.businessName?.trim();
  if (person && business && person.toLowerCase() !== business.toLowerCase()) {
    return `${person} at ${business}`;
  }
  return person || business || contact.e164 || fallback || "Contact";
}

export function needsYouRowCopy(row: NeedsYouRow): NeedsYouRowCopy {
  if (row.kind === "payment_link") {
    const amount = moneyLabel(row.card.amountMinor, row.card.currency).replace(
      /\.00$/u,
      "",
    );
    const purpose = row.card.purpose.trim() || row.card.invoiceLabel.trim();
    return {
      title: `Send a deposit link to ${row.card.recipient.name}, ${row.card.customerName}`,
      subtitle: purpose ? `${amount}. ${purpose}` : amount,
      yesLabel: "Send link",
      noLabel: "No",
    };
  }

  if (row.kind === "capability_gap") {
    const subtitle =
      row.item.group === "approve" && row.item.costText
        ? `${row.item.detail} · ${row.item.costText}`
        : row.item.detail || row.item.humanStep;
    return {
      title: row.item.title,
      subtitle,
      yesLabel: row.item.group === "approve" ? "Approve" : "Done",
      noLabel: row.item.group === "approve" ? "No" : null,
    };
  }

  if (row.kind === "call_request") {
    const name = contactName(row.contact, "");
    return {
      title: `Call ${name}`,
      subtitle: "Asked for a call.",
      yesLabel: "Pick a time",
      noLabel: null,
    };
  }

  if (row.kind === "draft") {
    return {
      title: `Reply to ${contactName(row.contact, row.draft?.to ?? row.detail.label)}`,
      subtitle: row.detail.text.trim() || "Reply prepared for you.",
      yesLabel: "Send",
      noLabel: "No",
    };
  }

  const { item } = row;
  if (item.source.kind === "whatsapp_batch") {
    const count = item.count ?? 0;
    const followUp = item.jobName === "Follow-ups";
    return {
      title: `${followUp ? "Follow up with" : "Message"} ${count} ${count === 1 ? "contact" : "contacts"}`,
      subtitle: followUp
        ? "WhatsApp. They read it and did not reply."
        : "WhatsApp. First message to each.",
      yesLabel: count > 0 ? `Send ${count}` : "Send",
      noLabel: "No",
    };
  }

  const yesLabel = (() => {
    switch (item.source.kind) {
      case "ask":
        if (item.category === "question" || item.section === "decide") {
          return "Answer";
        }
        if (item.category === "spend") return "Approve";
        if (item.category === "hire") return "Hire";
        return item.section === "do" ? "Done" : "Review";
      case "plan":
        if (item.section === "do") return "Done";
        if (/^start\b/iu.test(item.title)) return "Start";
        return /\bgo live\b|\blaunch\b/iu.test(
          `${item.title} ${item.subtitle ?? ""}`,
        )
          ? "Go live"
          : item.category === "hire"
            ? "Hire"
            : "Approve";
      case "playbook":
        return item.title.toLowerCase().startsWith("new playbook:")
          ? "Add it"
          : "Change it";
      case "playbook_job":
        if (item.section === "do") return "Done";
        if (/^start\b/iu.test(item.title)) return "Start";
        return /\bgo live\b|\blaunch\b/iu.test(
          `${item.title} ${item.subtitle ?? ""}`,
        )
          ? "Go live"
          : item.category === "hire"
            ? "Hire"
            : "Approve";
      case "goal":
        return "Approve";
      case "review_decision":
        return item.category === "hire" || /^hire\b/iu.test(item.title)
          ? "Hire"
          : "Approve";
      case "whatsapp_drafts":
        return "Send";
    }
  })();

  return {
    title:
      item.source.kind === "playbook" &&
      item.title.toLowerCase().startsWith("new playbook:")
        ? item.title.replace(/^New playbook:/iu, "New workflow:")
        : item.title,
    subtitle: item.subtitle ?? "",
    yesLabel,
    noLabel: item.actions.some((action) => action.id === "reject")
      ? "No"
      : null,
  };
}

export function needsYouRowPreparer(row: NeedsYouRow): string | null {
  switch (row.kind) {
    case "item":
      return row.item.fromPubkey;
    case "draft":
      return row.draft?.senderPubkey ?? row.item.fromPubkey;
    case "payment_link":
      return row.card.draftedBy;
    case "capability_gap":
      return row.item.proposedByPubkey;
    case "call_request":
      return row.contact.ownerPubkey;
  }
}

export function needsYouRowOpenLabel(row: NeedsYouRow): string {
  if (
    row.kind === "capability_gap" &&
    row.item.group === "do" &&
    row.item.pageUrl
  ) {
    return `Open browser for ${row.item.humanStep}`;
  }
  return `Open ${needsYouRowCopy(row).title}`;
}
