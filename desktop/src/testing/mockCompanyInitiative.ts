import type { MockCofounderSettings } from "./e2eBridge";

export type MockCompanyInitiativeRecord = {
  content: Record<string, unknown>;
};

type BriefContent = {
  whatYouSell: string;
  whoBuys: string;
  prices?: string;
  howYouTalk: string;
  sources: string[];
};

type OnboardingStepName = "brief" | "money" | "approvals" | "accounts" | "map";
type OnboardingStepState = "todo" | "asked" | "done" | "skipped";

type MutableOnboardingHead = Record<string, unknown> & {
  status: "in_progress" | "complete";
  revision: number;
  steps: Array<{ step: OnboardingStepName; state: OnboardingStepState }>;
  accounts: Array<{
    id: string;
    label: string;
    url?: string;
    state: "asked" | "done" | "skipped";
  }>;
  question?: {
    step: OnboardingStepName;
    account?: { id: string; label?: string; url?: string };
    [key: string]: unknown;
  };
  map?: {
    approved: boolean;
    [key: string]: unknown;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isMutableOnboardingHead(
  value: unknown,
): value is MutableOnboardingHead {
  return (
    isObject(value) &&
    value.status === "in_progress" &&
    typeof value.revision === "number" &&
    Array.isArray(value.steps) &&
    value.steps.every(
      (step) =>
        isObject(step) &&
        ["brief", "money", "approvals", "accounts", "map"].includes(
          String(step.step),
        ) &&
        ["todo", "asked", "done", "skipped"].includes(String(step.state)),
    ) &&
    Array.isArray(value.accounts) &&
    value.accounts.every(
      (account) =>
        isObject(account) &&
        typeof account.id === "string" &&
        typeof account.label === "string" &&
        (account.url === undefined || typeof account.url === "string") &&
        ["asked", "done", "skipped"].includes(String(account.state)),
    ) &&
    (value.question === undefined ||
      (isObject(value.question) &&
        ["brief", "money", "approvals", "accounts", "map"].includes(
          String(value.question.step),
        ) &&
        (value.question.account === undefined ||
          (isObject(value.question.account) &&
            typeof value.question.account.id === "string")))) &&
    (value.map === undefined ||
      (isObject(value.map) && typeof value.map.approved === "boolean"))
  );
}

function validBrief(value: unknown): value is BriefContent {
  return (
    isObject(value) &&
    hasOnlyKeys(value, [
      "whatYouSell",
      "whoBuys",
      "prices",
      "howYouTalk",
      "sources",
    ]) &&
    typeof value.whatYouSell === "string" &&
    value.whatYouSell.trim().length > 0 &&
    typeof value.whoBuys === "string" &&
    value.whoBuys.trim().length > 0 &&
    (value.prices === undefined ||
      (typeof value.prices === "string" && value.prices.trim().length > 0)) &&
    typeof value.howYouTalk === "string" &&
    value.howYouTalk.trim().length > 0 &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) => typeof source === "string" && source.trim().length > 0,
    )
  );
}

function nextHead(
  current: Record<string, unknown> | null,
  actorPubkey: string,
  nowSeconds: number,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision:
      (typeof current?.revision === "number" ? current.revision : 0) + 1,
    ...(current?.confirmed ? { confirmed: current.confirmed } : {}),
    ...(current?.pending ? { pending: current.pending } : {}),
    updatedByPubkey: actorPubkey,
    updatedAt: nowSeconds,
  };
}

export function applyMockBriefAction(input: {
  record: MockCompanyInitiativeRecord | null;
  currentHeadEventId: string | null;
  rawContent: string;
  actorPubkey: string;
  nowSeconds: number;
}): { error: string | null; record: MockCompanyInitiativeRecord | null } {
  let action: Record<string, unknown>;
  try {
    action = JSON.parse(input.rawContent) as Record<string, unknown>;
  } catch {
    return {
      error: "invalid: brief action is not JSON.",
      record: input.record,
    };
  }
  if (
    !hasOnlyKeys(action, [
      "schemaVersion",
      "kind",
      "content",
      "expectedHeadEventId",
    ]) ||
    action.schemaVersion !== 1 ||
    typeof action.kind !== "string" ||
    (input.currentHeadEventId === null
      ? action.expectedHeadEventId !== undefined
      : action.expectedHeadEventId !== input.currentHeadEventId)
  ) {
    return {
      error: "invalid: brief action has an unsupported or stale shape.",
      record: input.record,
    };
  }
  const current = input.record?.content ?? null;
  const next = nextHead(current, input.actorPubkey, input.nowSeconds);
  if (action.kind === "confirm") {
    if (!current?.pending) {
      return {
        error: "conflict: there is no business brief waiting to confirm.",
        record: input.record,
      };
    }
    next.confirmed = current.pending;
    delete next.pending;
    next.confirmedByPubkey = input.actorPubkey;
    next.confirmedAt = input.nowSeconds;
  } else if (action.kind === "edit" || action.kind === "propose") {
    if (!validBrief(action.content)) {
      return {
        error: "invalid: brief action needs valid brief content.",
        record: input.record,
      };
    }
    if (action.kind === "edit") {
      next.confirmed = action.content;
      delete next.pending;
      next.confirmedByPubkey = input.actorPubkey;
      next.confirmedAt = input.nowSeconds;
    } else {
      next.pending = action.content;
    }
  } else if (action.kind === "discard") {
    if (!current?.pending) {
      return {
        error: "conflict: there is no business brief proposal to discard.",
        record: input.record,
      };
    }
    delete next.pending;
  } else {
    return { error: "invalid: unknown brief action.", record: input.record };
  }
  return { error: null, record: { content: next } };
}

export function applyMockOnboardingAction(input: {
  record: MockCompanyInitiativeRecord | null;
  currentHeadEventId: string | null;
  rawContent: string;
  actorPubkey: string;
  role: "owner" | "admin" | "member" | null | undefined;
  brief: MockCompanyInitiativeRecord | null;
  settings: MockCofounderSettings | undefined;
  nowSeconds: number;
}): { error: string | null; record: MockCompanyInitiativeRecord | null } {
  let action: Record<string, unknown>;
  try {
    action = JSON.parse(input.rawContent) as Record<string, unknown>;
  } catch {
    return {
      error: "invalid: onboarding action is not JSON.",
      record: input.record,
    };
  }
  if (
    !hasOnlyKeys(action, [
      "schemaVersion",
      "kind",
      "step",
      "text",
      "account",
      "map",
      "skipped",
      "moneyPreference",
      "approvalSwitches",
      "leadPubkey",
      "expectedHeadEventId",
    ]) ||
    action.schemaVersion !== 1 ||
    typeof action.kind !== "string" ||
    action.expectedHeadEventId !== input.currentHeadEventId
  ) {
    return {
      error: "invalid: onboarding action has an unsupported or stale shape.",
      record: input.record,
    };
  }
  if (
    ["answer", "approve_map", "reject_map"].includes(action.kind) &&
    input.role !== "owner" &&
    input.role !== "admin"
  ) {
    return {
      error: "restricted: only the owner or an admin can answer onboarding.",
      record: input.record,
    };
  }
  const current = input.record?.content;
  if (!isMutableOnboardingHead(current)) {
    return {
      error: "conflict: onboarding is not in progress.",
      record: input.record,
    };
  }
  const next = structuredClone(current);
  const now = Math.max(input.nowSeconds, Number(current.updatedAt ?? 0) + 1);
  const stepIndex = (step: OnboardingStepName) =>
    next.steps.findIndex((item) => item.step === step);
  if (action.kind === "answer") {
    const step = action.step as OnboardingStepName;
    if (
      typeof step !== "string" ||
      !["brief", "money", "approvals", "accounts"].includes(step) ||
      !isObject(next.question) ||
      next.question.step !== step
    ) {
      return {
        error: "conflict: that question is not open.",
        record: input.record,
      };
    }
    if (!action.skipped) {
      if (step === "brief" && !input.brief?.content.confirmed) {
        return {
          error: "conflict: confirm the business brief first.",
          record: input.record,
        };
      }
      if (
        step === "money" &&
        (!input.settings ||
          action.moneyPreference !== input.settings.moneyPreference)
      ) {
        return {
          error: "conflict: save the money setting first.",
          record: input.record,
        };
      }
      if (
        step === "approvals" &&
        (!input.settings ||
          JSON.stringify(action.approvalSwitches) !==
            JSON.stringify(input.settings.approvalSwitches))
      ) {
        return {
          error: "conflict: save the approval switches first.",
          record: input.record,
        };
      }
    }
    const index = stepIndex(step);
    if (index < 0)
      return {
        error: "invalid: onboarding step is missing.",
        record: input.record,
      };
    next.steps[index].state = action.skipped ? "skipped" : "done";
    if (step === "accounts" && isObject(next.question.account)) {
      const accountId = next.question.account.id;
      const account = next.accounts.find(
        (candidate) => candidate.id === accountId,
      );
      if (account) account.state = action.skipped ? "skipped" : "done";
    }
    delete next.question;
  } else if (action.kind === "approve_map") {
    if (!isObject(next.map) || next.map.approved) {
      return {
        error: "conflict: there is no proposed map to approve.",
        record: input.record,
      };
    }
    next.map.approved = true;
    const index = stepIndex("map");
    if (index >= 0) next.steps[index].state = "done";
  } else if (action.kind === "reject_map") {
    if (!next.map)
      return {
        error: "conflict: there is no proposed map to turn down.",
        record: input.record,
      };
    delete next.map;
    const index = stepIndex("map");
    if (index >= 0) next.steps[index].state = "todo";
  } else if (action.kind === "complete") {
    const settledSteps: OnboardingStepName[] = [
      "brief",
      "money",
      "approvals",
      "map",
    ];
    const settled = settledSteps.every((step) => {
      const state = next.steps[stepIndex(step)]?.state;
      return state === "done" || state === "skipped";
    });
    if (next.question || !next.map?.approved || !settled) {
      return {
        error: "conflict: finish the onboarding steps first.",
        record: input.record,
      };
    }
    next.status = "complete";
    next.completedAt = now;
  } else {
    return {
      error: "invalid: unsupported onboarding action.",
      record: input.record,
    };
  }
  next.revision = Number(current.revision ?? 0) + 1;
  next.updatedByPubkey = input.actorPubkey;
  next.updatedAt = now;
  return { error: null, record: { content: next } };
}
