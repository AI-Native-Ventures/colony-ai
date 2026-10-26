import {
  businessDTag,
  KIND_PROSPECT_HEAD,
  tryParseContent,
  type ProspectHead,
  type ProspectStage,
} from "@/features/discovery/businessRecordContract";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { RelayEvent } from "@/shared/api/types";

/** Pill tones shared with the Leads table: won green, lost red, and so on. */
export type LeadTone = "neutral" | "green" | "blue" | "amber" | "red";

/** What a chat reference shows about a lead. */
export type LeadSummary = {
  leadId: string;
  name: string;
  /** `<vertical> · <location>`, whichever parts exist. */
  meta: string;
  stageLabel: string;
  stageTone: LeadTone;
  fitScore: number | null;
};

const STAGE_LABELS: Record<ProspectStage, string> = {
  qualified: "Qualified",
  in_conversation: "In conversation",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

const STAGE_TONES: Record<ProspectStage, LeadTone> = {
  qualified: "neutral",
  in_conversation: "blue",
  proposal: "amber",
  won: "green",
  lost: "red",
};

/** How many head events one lookup asks for; the newest wins. */
export const LEAD_HEAD_QUERY_LIMIT = 5;

const SALES_AUTHORIZATION_PATTERN =
  /restricted|blocked|forbidden|not authori[sz]ed|not a member|permission|access denied/i;

/**
 * Won and lost always show as such. A lead nobody has reviewed yet reads
 * "New", exactly as in the Leads table; otherwise its pipeline stage shows.
 */
export function leadStageLabel(prospect: ProspectHead["prospect"]): string {
  if (prospect.stage === "won" || prospect.stage === "lost") {
    return STAGE_LABELS[prospect.stage];
  }
  if (prospect.qualification === "unreviewed") return "New";
  return STAGE_LABELS[prospect.stage] ?? prospect.stage;
}

export function leadStageTone(prospect: ProspectHead["prospect"]): LeadTone {
  if (prospect.stage === "won" || prospect.stage === "lost") {
    return STAGE_TONES[prospect.stage];
  }
  if (prospect.qualification === "unreviewed") return "neutral";
  return STAGE_TONES[prospect.stage] ?? "neutral";
}

/** The single letter on the card's mark. */
export function leadInitial(name: string): string {
  const letter = name.trim().slice(0, 1);
  return letter ? letter.toLocaleUpperCase() : "?";
}

export function leadMeta(prospect: ProspectHead["prospect"]): string {
  return [prospect.vertical, prospect.location]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Summary of an active lead; `null` when it is archived or unreadable. */
export function summarizeLead(head: ProspectHead): LeadSummary | null {
  if (head.status !== "active" || !head.prospect?.party) return null;
  const prospect = head.prospect;
  return {
    leadId: head.prospectId,
    name: prospect.party.displayName,
    meta: leadMeta(prospect),
    stageLabel: leadStageLabel(prospect),
    stageTone: leadStageTone(prospect),
    fitScore: typeof prospect.fitScore === "number" ? prospect.fitScore : null,
  };
}

/** The relay filter for one lead's head, scoped to the business channel. */
export function leadHeadFilter(
  channelId: string,
  communityId: TenantCommunityId,
  leadId: string,
) {
  return {
    kinds: [KIND_PROSPECT_HEAD],
    "#h": [channelId],
    "#d": [businessDTag(communityId, "prospect", leadId)],
    limit: LEAD_HEAD_QUERY_LIMIT,
  };
}

/** Newest parseable head among the events; ties break on the higher id. */
export function newestLeadHead(events: RelayEvent[]): ProspectHead | null {
  let newest: { event: RelayEvent; head: ProspectHead } | null = null;
  for (const event of events) {
    if (event.kind !== KIND_PROSPECT_HEAD) continue;
    const head = tryParseContent<ProspectHead>(event);
    if (!head || typeof head.prospectId !== "string") continue;
    if (
      !newest ||
      event.created_at > newest.event.created_at ||
      (event.created_at === newest.event.created_at &&
        event.id > newest.event.id)
    ) {
      newest = { event, head };
    }
  }
  return newest?.head ?? null;
}

/** True when the relay refused the read, as opposed to a network failure. */
export function isLeadAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return SALES_AUTHORIZATION_PATTERN.test(message);
}

export type LeadReferenceView =
  | { kind: "loading" }
  | { kind: "ready"; lead: LeadSummary }
  | { kind: "missing" }
  | { kind: "no-access" }
  | { kind: "error" };

/** Maps query state onto the one view the card renders. */
export function leadReferenceView(input: {
  isPending: boolean;
  error: unknown;
  head: ProspectHead | null | undefined;
}): LeadReferenceView {
  if (input.error) {
    return isLeadAccessError(input.error)
      ? { kind: "no-access" }
      : { kind: "error" };
  }
  if (input.isPending) return { kind: "loading" };
  const lead = input.head ? summarizeLead(input.head) : null;
  return lead ? { kind: "ready", lead } : { kind: "missing" };
}

/**
 * The editor nodes that insert a lead reference at the caret: a space first
 * when the text before the caret does not already end in one, then the chip,
 * then a trailing space so typing continues after it.
 */
export function leadReferenceContent(input: {
  textBeforeCaret: string;
  chipNodeName: string;
  attrs: { channelName: string; href: string };
}): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (input.textBeforeCaret.length > 0 && !/\s$/.test(input.textBeforeCaret)) {
    content.push({ type: "text", text: " " });
  }
  content.push({ type: input.chipNodeName, attrs: input.attrs });
  content.push({ type: "text", text: " " });
  return content;
}

/** Case-insensitive match on name, vertical and location for the picker. */
export function filterLeads<T extends { name: string; meta: string }>(
  leads: T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return leads;
  return leads.filter((lead) =>
    `${lead.name} ${lead.meta}`.toLocaleLowerCase().includes(needle),
  );
}
