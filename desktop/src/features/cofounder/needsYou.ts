import type {
  AskCategory,
  AskHeadRecord,
  AskType,
} from "@/features/company-asks/askRecords";
import type {
  WhatsAppBatchSummary,
  WhatsAppDraft,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";

import { FUNCTION_DETAILS } from "./functions";
import { METRIC_DETAILS, formatMetricValue } from "./numbersRecords";
import type { GoalView, ReviewView } from "./numbersRecords";
import {
  openHumanSteps,
  planTotals,
  stepsWaitingForApproval,
} from "./planRecords";
import type { PlanApprovalKind, PlanView } from "./planRecords";

/**
 * The one list of what the owner must approve, do or decide.
 *
 * It is built from existing asks plus co-founder plans plus the WhatsApp
 * outreach queue. Other lanes add a source by extending `NeedsYouSources`,
 * never by building a second list.
 */
export type NeedsYouSection = "approve" | "do" | "decide";

export type NeedsYouCategory =
  | "plan"
  | "plan_step"
  | "goal"
  | "review_decision"
  | "outreach"
  | "spend"
  | "taste"
  | "hire"
  | "tool"
  | "playbook"
  | "duty"
  | "question"
  | "other";

export type NeedsYouActionId =
  | "approve"
  | "edit"
  | "reject"
  | "review"
  | "send"
  | "discard"
  | "done"
  | "answer";

export type NeedsYouAction = {
  id: NeedsYouActionId;
  label: string;
  tone: "primary" | "secondary" | "danger";
};

export type NeedsYouSource =
  | { kind: "plan"; planId: string; stepId: string | null }
  | { kind: "goal"; goalId: string }
  | { kind: "review_decision"; reviewDate: string; decisionId: string }
  | { kind: "ask"; askId: string; channelId: string }
  | { kind: "whatsapp_batch"; batchId: string }
  | { kind: "whatsapp_drafts"; senderPubkey: string | null };

export type NeedsYouDetail = { id: string; label: string; text: string };

export type NeedsYouItem = {
  /** Stable across refreshes; safe as a React key. */
  id: string;
  section: NeedsYouSection;
  category: NeedsYouCategory;
  title: string;
  subtitle: string | null;
  /** Who asks: an agent pubkey when known, so the UI can show name and avatar. */
  fromPubkey: string | null;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds, when the asker wants an answer by. */
  decideBy: number | null;
  /** For plan steps: what the approval point asks about. */
  approvalKind: PlanApprovalKind | null;
  /** Number of things the item stands for (rows in a batch, drafts waiting). */
  count: number | null;
  details: NeedsYouDetail[];
  source: NeedsYouSource;
  actions: NeedsYouAction[];
};

export type NeedsYouModel = {
  approve: NeedsYouItem[];
  do: NeedsYouItem[];
  decide: NeedsYouItem[];
  total: number;
};

export type NeedsYouSources = {
  /** Owner or admin: only they approve plans, steps, batches and drafts. */
  canApprove: boolean;
  /** Open asks addressed to the viewer (`useNeedsMeQuery().data.asks`). */
  asks: readonly AskHeadRecord[];
  plans: readonly PlanView[];
  /** Pending WhatsApp batches. Pass `[]` for anyone who cannot see them. */
  whatsappBatches: readonly WhatsAppBatchSummary[];
  /** Agent drafts waiting for the owner. */
  whatsappDrafts: readonly WhatsAppDraft[];
  /** Goals Scout proposed for the functions. Leave out for a viewer who cannot see them. */
  goals?: readonly GoalView[];
  /** Weekly reviews; each decision still open is a decide item. */
  reviews?: readonly ReviewView[];
};

const APPROVE_ACTIONS: NeedsYouAction[] = [
  { id: "approve", label: "Approve", tone: "primary" },
  { id: "edit", label: "Edit", tone: "secondary" },
  { id: "reject", label: "Reject", tone: "danger" },
];

function seconds(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function askSection(type: AskType): NeedsYouSection {
  switch (type) {
    case "approval":
    case "tool_consent":
    case "verdict":
      return "approve";
    case "checklist":
      return "do";
    default:
      return "decide";
  }
}

function askCategory(category: AskCategory, type: AskType): NeedsYouCategory {
  switch (category) {
    case "money":
      return "spend";
    case "hire":
      return "hire";
    case "tool":
      return "tool";
    case "duty":
      return "duty";
    case "secret":
      return "other";
    default:
      return type === "question" || type === "choice" ? "question" : "other";
  }
}

function askActions(section: NeedsYouSection): NeedsYouAction[] {
  if (section === "approve") {
    return [{ id: "review", label: "Review and approve", tone: "primary" }];
  }
  if (section === "do") {
    return [{ id: "done", label: "Done", tone: "primary" }];
  }
  return [{ id: "answer", label: "Answer", tone: "primary" }];
}

function functionName(plan: PlanView): string | null {
  return plan.functionId ? FUNCTION_DETAILS[plan.functionId].name : null;
}

function planSubtitle(plan: PlanView): string {
  const parts: string[] = [];
  const fn = functionName(plan);
  if (fn) parts.push(fn);
  parts.push(
    `${plan.steps.length} ${plan.steps.length === 1 ? "step" : "steps"}`,
  );
  const totals = planTotals(plan);
  if (totals.timingLabel) parts.push(totals.timingLabel);
  return parts.join(" · ");
}

const GOAL_PERIOD_LABEL = { week: "a week", month: "a month" } as const;

function goalSubtitle(goal: GoalView): string {
  const detail = METRIC_DETAILS[goal.metric];
  const target =
    formatMetricValue(goal.target, detail.unit, "ZAR") ?? String(goal.target);
  return `${FUNCTION_DETAILS[goal.functionId].name} · ${detail.label} ${target} ${GOAL_PERIOD_LABEL[goal.period]}`;
}

function stepCategory(kind: PlanApprovalKind): NeedsYouCategory {
  switch (kind) {
    case "outreach":
      return "outreach";
    case "spend":
      return "spend";
    case "taste":
      return "taste";
    case "hire":
      return "hire";
    default:
      return "plan_step";
  }
}

function byUrgency(first: NeedsYouItem, second: NeedsYouItem): number {
  if (first.decideBy !== null && second.decideBy !== null) {
    if (first.decideBy !== second.decideBy)
      return first.decideBy - second.decideBy;
  } else if (first.decideBy !== null) {
    return -1;
  } else if (second.decideBy !== null) {
    return 1;
  }
  return (
    second.createdAt - first.createdAt || first.id.localeCompare(second.id)
  );
}

/** Pure: same sources, same model. */
export function buildNeedsYou(sources: NeedsYouSources): NeedsYouModel {
  const items: NeedsYouItem[] = [];

  for (const record of sources.asks) {
    const { ask, askerPubkey, createdAt, status } = record.head;
    if (status !== "open") continue;
    const section = askSection(ask.type);
    items.push({
      id: `ask:${ask.askId}`,
      section,
      category: askCategory(ask.category, ask.type),
      title: ask.title,
      subtitle: ask.body?.trim() ? ask.body.trim().slice(0, 140) : null,
      fromPubkey: askerPubkey,
      createdAt: seconds(createdAt),
      decideBy: ask.decideBy ? seconds(ask.decideBy) || null : null,
      approvalKind: null,
      count: null,
      details: [],
      source: { kind: "ask", askId: ask.askId, channelId: record.channelId },
      actions: askActions(section),
    });
  }

  for (const plan of sources.plans) {
    if (plan.status === "proposed" && sources.canApprove) {
      items.push({
        id: `plan:${plan.planId}`,
        section: "approve",
        category: "plan",
        title: plan.title,
        subtitle: planSubtitle(plan),
        fromPubkey: plan.proposedByPubkey,
        createdAt: plan.proposedAt,
        decideBy: plan.decideBy,
        approvalKind: null,
        count: plan.steps.length,
        details: [],
        source: { kind: "plan", planId: plan.planId, stepId: null },
        actions: APPROVE_ACTIONS,
      });
    }
    if (!sources.canApprove) continue;
    for (const step of stepsWaitingForApproval(plan)) {
      if (!step.approvalPoint) continue;
      items.push({
        id: `plan-step:${plan.planId}:${step.stepId}`,
        section: "approve",
        category: stepCategory(step.approvalPoint.kind),
        title: step.title,
        subtitle: `${plan.title} · ${step.approvalPoint.prompt}`,
        fromPubkey: plan.proposedByPubkey,
        createdAt: plan.updatedAt,
        decideBy: null,
        approvalKind: step.approvalPoint.kind,
        count: null,
        details: [],
        source: { kind: "plan", planId: plan.planId, stepId: step.stepId },
        actions: [
          { id: "approve", label: "Approve", tone: "primary" },
          { id: "reject", label: "Reject", tone: "danger" },
        ],
      });
    }
    for (const step of openHumanSteps(plan)) {
      items.push({
        id: `plan-step:${plan.planId}:${step.stepId}`,
        section: "do",
        category: "plan_step",
        title: step.title,
        subtitle: step.detail ?? plan.title,
        fromPubkey: plan.proposedByPubkey,
        createdAt: plan.updatedAt,
        decideBy: null,
        approvalKind: null,
        count: null,
        details: [],
        source: { kind: "plan", planId: plan.planId, stepId: step.stepId },
        actions: [{ id: "done", label: "Done", tone: "primary" }],
      });
    }
  }

  if (sources.canApprove) {
    for (const goal of sources.goals ?? []) {
      if (goal.status !== "proposed") continue;
      items.push({
        id: `goal:${goal.goalId}`,
        section: "approve",
        category: "goal",
        title: goal.title,
        subtitle: goalSubtitle(goal),
        fromPubkey: goal.proposedByPubkey,
        createdAt: goal.proposedAt,
        decideBy: null,
        approvalKind: null,
        count: null,
        details: goal.reason
          ? [{ id: "reason", label: "Why", text: goal.reason }]
          : [],
        source: { kind: "goal", goalId: goal.goalId },
        actions: [
          { id: "approve", label: "Approve", tone: "primary" },
          { id: "reject", label: "Reject", tone: "danger" },
        ],
      });
    }
    for (const review of sources.reviews ?? []) {
      for (const decision of review.decisions) {
        if (decision.state !== "open") continue;
        items.push({
          id: `review-decision:${review.reviewDate}:${decision.decisionId}`,
          section: "decide",
          category: "review_decision",
          title: decision.title,
          subtitle: decision.detail.trim() ? decision.detail.trim() : null,
          fromPubkey: review.annotatedByPubkey,
          createdAt: review.annotatedAt ?? review.createdAt,
          decideBy: null,
          approvalKind: null,
          count: null,
          details: [],
          source: {
            kind: "review_decision",
            reviewDate: review.reviewDate,
            decisionId: decision.decisionId,
          },
          actions: [
            { id: "approve", label: "Yes", tone: "primary" },
            { id: "reject", label: "No", tone: "secondary" },
            { id: "answer", label: "Later", tone: "secondary" },
          ],
        });
      }
    }
    for (const batch of sources.whatsappBatches) {
      if (batch.status !== "pending") continue;
      items.push({
        id: `wa-batch:${batch.batchId}`,
        section: "approve",
        category: "outreach",
        title: `WhatsApp batch of ${batch.rows.total} ${batch.rows.total === 1 ? "message" : "messages"}`,
        subtitle: `Template: ${batch.template}`,
        fromPubkey: batch.createdBy || null,
        createdAt: seconds(batch.createdAt),
        decideBy: null,
        approvalKind: "outreach",
        count: batch.rows.total,
        details: [],
        source: { kind: "whatsapp_batch", batchId: batch.batchId },
        actions: [
          { id: "review", label: "Review and approve", tone: "primary" },
          { id: "reject", label: "Reject", tone: "danger" },
        ],
      });
    }
    const draftsBySender = new Map<string, WhatsAppDraft[]>();
    for (const draft of sources.whatsappDrafts) {
      if (draft.state !== "draft") continue;
      const key = draft.senderPubkey ?? "";
      draftsBySender.set(key, [...(draftsBySender.get(key) ?? []), draft]);
    }
    for (const [sender, drafts] of draftsBySender) {
      const newest = Math.max(
        ...drafts.map((draft) => seconds(draft.createdAt)),
      );
      items.push({
        id: `wa-drafts:${sender || "unknown"}`,
        section: "approve",
        category: "outreach",
        title: `${drafts.length} reply ${drafts.length === 1 ? "draft" : "drafts"}`,
        subtitle: "Only your own messages send at once. These wait for you.",
        fromPubkey: sender || null,
        createdAt: newest,
        decideBy: null,
        approvalKind: "outreach",
        count: drafts.length,
        details: drafts.map((draft) => ({
          id: draft.id,
          label: draft.to,
          text: draft.text,
        })),
        source: { kind: "whatsapp_drafts", senderPubkey: sender || null },
        actions: [
          { id: "send", label: "Send", tone: "primary" },
          { id: "edit", label: "Edit", tone: "secondary" },
          { id: "discard", label: "Discard", tone: "danger" },
        ],
      });
    }
  }

  const section = (name: NeedsYouSection) =>
    items.filter((item) => item.section === name).sort(byUrgency);
  const approve = section("approve");
  const doItems = section("do");
  const decide = section("decide");
  return {
    approve,
    do: doItems,
    decide,
    total: approve.length + doItems.length + decide.length,
  };
}
