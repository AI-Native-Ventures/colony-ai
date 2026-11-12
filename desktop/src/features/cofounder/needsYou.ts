import type {
  AskCategory,
  AskHeadRecord,
  AskRecord,
  AskType,
} from "@/features/company-asks/askRecords";
import type {
  WhatsAppBatchDetail,
  WhatsAppBatchSummary,
  WhatsAppDraft,
} from "@/features/whatsapp-outreach/whatsappOutreachModels";

import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions";
import type { FunctionId } from "./cofounderRecords";
import { METRIC_DETAILS, formatMetricValue } from "./numbersRecords";
import type { GoalView, ReviewView } from "./numbersRecords";
import {
  openHumanSteps,
  planTotals,
  stepsWaitingForApproval,
} from "./planRecords";
import type { PlanApprovalKind, PlanView } from "./planRecords";
import {
  jobOpenHumanSteps,
  jobStepsWaitingForApproval,
} from "./playbookRecords";
import type { JobView, PlaybookView } from "./playbookRecords";

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
  | { kind: "playbook"; playbookId: string }
  | { kind: "playbook_job"; jobId: string; stepId: string }
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
  /** Company part that owns this decision, or null when it is company-wide. */
  functionId: FunctionId | null;
  /** A canonical sub-function name when the item's owner is specific enough. */
  jobName: string | null;
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
  /** Playbooks with a proposal waiting for the owner. Optional: omit it for none. */
  playbooks?: readonly PlaybookView[];
  /** Running copies: a step at its approval point waits for the owner, a step only a person can do is theirs. */
  playbookJobs?: readonly JobView[];
  /** Pending WhatsApp batches. Pass `[]` for anyone who cannot see them. */
  whatsappBatches: readonly WhatsAppBatchSummary[];
  /** Optional details identify follow-up batches without changing the relay shape. */
  whatsappBatchDetails?: readonly WhatsAppBatchDetail[];
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

function canonicalJobName(
  functionId: FunctionId | null,
  candidate: string | null | undefined,
): string | null {
  if (!functionId || !candidate?.trim()) return null;
  return (
    FUNCTION_DETAILS[functionId].subFunctions.find(
      (name) =>
        name.toLocaleLowerCase() === candidate.trim().toLocaleLowerCase(),
    ) ?? null
  );
}

function normalizedWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function inferFunctionId(value: string): FunctionId | null {
  const normalized = normalizedWords(value);
  const matches = FUNCTION_ORDER.filter((functionId) => {
    const functionName = normalizedWords(FUNCTION_DETAILS[functionId].name);
    return (
      hasPhrase(normalized, functionName) ||
      FUNCTION_DETAILS[functionId].subFunctions.some((job) => {
        const jobName = normalizedWords(job);
        const singular = jobName.endsWith("s") ? jobName.slice(0, -1) : jobName;
        return (
          hasPhrase(normalized, jobName) || hasPhrase(normalized, singular)
        );
      })
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

function askFunctionId(
  ask: AskRecord,
  goals: readonly GoalView[],
): FunctionId | null {
  if (ask.subject?.kind === "goal") {
    const goalFunction = goals.find(
      (goal) => goal.goalId === ask.subject?.id,
    )?.functionId;
    if (goalFunction) return goalFunction;
  }
  if (ask.subject?.kind === "workflowRun" || ask.subject?.kind === "workItem") {
    return "operations";
  }
  if (ask.category === "money") return "finance";

  const role = [
    ask.title,
    ask.body ?? "",
    ask.hireProposal?.title ?? "",
    ask.hireProposal?.rolePack.job ?? "",
  ].join(" ");
  const normalized = normalizedWords(role);
  if (hasPhrase(normalized, "customer success")) return "customer_success";
  if (hasPhrase(normalized, "bookkeeper") || hasPhrase(normalized, "finance"))
    return "finance";
  if (
    hasPhrase(normalized, "business development") ||
    hasPhrase(normalized, "sales")
  )
    return "sales";
  if (hasPhrase(normalized, "brand") || hasPhrase(normalized, "content"))
    return "brand";
  if (hasPhrase(normalized, "delivery") || hasPhrase(normalized, "operations"))
    return "operations";
  return inferFunctionId(normalized);
}

function askJobName(
  ask: AskRecord,
  functionId: FunctionId | null,
): string | null {
  if (!functionId) return null;
  const text = normalizedWords(`${ask.title} ${ask.body ?? ""}`).replace(
    /follow up(?!s)/gu,
    "follow ups",
  );
  const job = FUNCTION_DETAILS[functionId].subFunctions.find((name) => {
    const normalizedName = normalizedWords(name);
    const singular = normalizedName.endsWith("s")
      ? normalizedName.slice(0, -1)
      : normalizedName;
    return hasPhrase(text, normalizedName) || hasPhrase(text, singular);
  });
  if (job) return job;
  return ask.category === "money" && functionId === "finance" ? "Costs" : null;
}

function playbookJobName(title: string, functionId: FunctionId): string | null {
  const candidate = title
    .replace(/^new playbook:\s*/iu, "")
    .replace(/^change to\s*/iu, "")
    .replace(/\s+playbook$/iu, "")
    .trim();
  return canonicalJobName(functionId, candidate);
}

function isFollowUpBatch(
  batch: WhatsAppBatchSummary,
  details: readonly WhatsAppBatchDetail[],
): boolean {
  const detail = details.find((item) => item.batchId === batch.batchId);
  return /follow[ -]?up/iu.test(
    `${detail?.note ?? ""} ${detail?.template ?? batch.template}`,
  );
}

function functionName(plan: PlanView): string | null {
  const functionId =
    plan.functionId ?? inferFunctionId(`${plan.title} ${plan.summary}`);
  return functionId ? FUNCTION_DETAILS[functionId].name : null;
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
      functionId: askFunctionId(ask, sources.goals ?? []),
      jobName: askJobName(ask, askFunctionId(ask, sources.goals ?? [])),
      approvalKind: null,
      count: null,
      details: [],
      source: { kind: "ask", askId: ask.askId, channelId: record.channelId },
      actions: askActions(section),
    });
  }

  for (const plan of sources.plans) {
    const functionId =
      plan.functionId ?? inferFunctionId(`${plan.title} ${plan.summary}`);
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
        functionId,
        jobName: null,
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
        functionId,
        jobName: null,
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
        functionId,
        jobName: null,
        approvalKind: null,
        count: null,
        details: [],
        source: { kind: "plan", planId: plan.planId, stepId: step.stepId },
        actions: [{ id: "done", label: "Done", tone: "primary" }],
      });
    }
  }

  if (sources.canApprove) {
    for (const playbook of sources.playbooks ?? []) {
      const { pending } = playbook;
      if (
        !pending ||
        (playbook.status !== "proposed" && playbook.status !== "active")
      )
        continue;
      items.push({
        id: `playbook:${playbook.playbookId}`,
        section: "approve",
        category: "playbook",
        title:
          playbook.version === 0
            ? `New playbook: ${pending.content.title}`
            : `Change to ${playbook.title}`,
        subtitle:
          pending.changeSummary ??
          `${pending.content.steps.length} ${pending.content.steps.length === 1 ? "step" : "steps"}`,
        fromPubkey: pending.proposedByPubkey,
        createdAt: pending.proposedAt,
        decideBy: null,
        functionId: "operations",
        jobName: playbookJobName(pending.content.title, "operations"),
        approvalKind: null,
        count: pending.content.steps.length,
        details: [],
        source: { kind: "playbook", playbookId: playbook.playbookId },
        actions: APPROVE_ACTIONS,
      });
    }
    for (const job of sources.playbookJobs ?? []) {
      for (const step of jobStepsWaitingForApproval(job)) {
        if (!step.approvalPoint) continue;
        items.push({
          id: `playbook-step:${job.jobId}:${step.stepId}`,
          section: "approve",
          category: stepCategory(step.approvalPoint.kind),
          title: step.title,
          subtitle: `${job.title} · ${step.approvalPoint.prompt}`,
          fromPubkey: step.owner.agentPubkey ?? job.startedByPubkey,
          createdAt: step.statusAt,
          decideBy: null,
          functionId: "operations",
          jobName: playbookJobName(job.playbookTitle, "operations"),
          approvalKind: step.approvalPoint.kind,
          count: null,
          details: [],
          source: {
            kind: "playbook_job",
            jobId: job.jobId,
            stepId: step.stepId,
          },
          actions: [
            { id: "approve", label: "Approve", tone: "primary" },
            { id: "reject", label: "Reject", tone: "danger" },
          ],
        });
      }
      for (const step of jobOpenHumanSteps(job)) {
        items.push({
          id: `playbook-step:${job.jobId}:${step.stepId}`,
          section: "do",
          category: "plan_step",
          title: step.title,
          subtitle: step.detail ?? `${job.title} · ${job.playbookTitle}`,
          fromPubkey: job.startedByPubkey,
          createdAt: step.statusAt,
          decideBy: null,
          functionId: "operations",
          jobName: playbookJobName(job.playbookTitle, "operations"),
          approvalKind: null,
          count: null,
          details: [],
          source: {
            kind: "playbook_job",
            jobId: job.jobId,
            stepId: step.stepId,
          },
          actions: [{ id: "done", label: "Done", tone: "primary" }],
        });
      }
    }
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
        functionId: goal.functionId,
        jobName: null,
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
          functionId:
            decision.functionId ??
            inferFunctionId(`${decision.title} ${decision.detail}`),
          jobName: null,
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
        functionId: "sales",
        jobName: isFollowUpBatch(batch, sources.whatsappBatchDetails ?? [])
          ? "Follow-ups"
          : "Outreach",
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
        functionId: "sales",
        jobName: "Follow-ups",
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
