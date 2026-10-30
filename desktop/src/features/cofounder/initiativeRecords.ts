import {
  KIND_BRIEF_HEAD,
  KIND_ONBOARDING_HEAD,
} from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

import { FUNCTION_ORDER } from "./functions";
import {
  COMPANY_RECORD_SCHEMA_VERSION,
  PUBKEY_PATTERN,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
  readNumber,
} from "./cofounderRecords";
import type {
  ApprovalSwitches,
  FunctionId,
  MoneyPreference,
} from "./cofounderRecords";

export {
  KIND_BRIEF_ACTION,
  KIND_BRIEF_HEAD,
  KIND_ONBOARDING_ACTION,
  KIND_ONBOARDING_HEAD,
} from "@/shared/constants/kinds";

export const BRIEF_D_TAG = "company:brief";
export const ONBOARDING_D_TAG = "company:onboarding";

export type BriefContent = {
  whatYouSell: string;
  whoBuys: string;
  prices?: string;
  howYouTalk: string;
  sources: string[];
};

export type BriefHead = {
  revision: number;
  confirmed: BriefContent | null;
  pending: BriefContent | null;
  confirmedByPubkey: string | null;
  confirmedAt: number | null;
  updatedByPubkey: string;
  updatedAt: number;
  eventId: string;
};

export type OnboardingStep =
  | "brief"
  | "money"
  | "approvals"
  | "accounts"
  | "map";
export type OnboardingStepState = "todo" | "asked" | "done" | "skipped";
export type AccountState = "asked" | "done" | "skipped";
export type AccountRequest = { id: string; label: string; url?: string };
export type OnboardingAccount = AccountRequest & { state: AccountState };
export type MapPlacement = "existing_agent" | "scout" | "empty";
export type OnboardingMapEntry = {
  function: FunctionId;
  placement: MapPlacement;
  leadPubkey?: string;
};
export type OnboardingMap = {
  entries: OnboardingMapEntry[];
  firstFunction: FunctionId;
  approved: boolean;
};
export type OnboardingHead = {
  revision: number;
  status: "in_progress" | "complete";
  leadPubkey: string;
  steps: Array<{ step: OnboardingStep; state: OnboardingStepState }>;
  question: {
    step: OnboardingStep;
    text: string;
    account?: AccountRequest;
  } | null;
  accounts: OnboardingAccount[];
  map: OnboardingMap | null;
  startedAt: number;
  resumedAt: number | null;
  resumeCount: number;
  completedAt: number | null;
  updatedByPubkey: string;
  updatedAt: number;
  eventId: string;
};

const BRIEF_FIELDS = [
  "whatYouSell",
  "whoBuys",
  "prices",
  "howYouTalk",
  "sources",
];
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "brief",
  "money",
  "approvals",
  "accounts",
  "map",
];
const FUNCTION_IDS = new Set<string>(FUNCTION_ORDER);
const ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isText(value: unknown, max = 600): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

function parseBriefContent(value: unknown): BriefContent | null {
  if (!isObject(value) || !hasOnlyKeys(value, BRIEF_FIELDS)) return null;
  const whatYouSell = pick(value, "whatYouSell");
  const whoBuys = pick(value, "whoBuys");
  const prices = pick(value, "prices");
  const howYouTalk = pick(value, "howYouTalk");
  const sources = pick(value, "sources");
  if (
    !isText(whatYouSell) ||
    !isText(whoBuys) ||
    (prices !== undefined && !isText(prices)) ||
    !isText(howYouTalk) ||
    !Array.isArray(sources) ||
    sources.length > 8 ||
    !sources.every((source) => isText(source, 80))
  ) {
    return null;
  }
  return {
    whatYouSell,
    whoBuys,
    ...(typeof prices === "string" ? { prices } : {}),
    howYouTalk,
    sources,
  };
}

export function parseBriefHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): BriefHead | null {
  if (
    !isValidRelayHead(event, relaySelfPubkey, KIND_BRIEF_HEAD) ||
    event.tags.length !== 1 ||
    oneTagValue(event, "d") !== BRIEF_D_TAG
  ) {
    return null;
  }
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    false ||
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION
  ) {
    return null;
  }
  const revision = readNumber(content, "revision");
  const updatedByPubkey = pick(content, "updatedByPubkey");
  const updatedAt = readNumber(content, "updatedAt");
  const confirmed = pick(content, "confirmed");
  const pending = pick(content, "pending");
  const confirmedByPubkey = pick(content, "confirmedByPubkey");
  const confirmedAt = pick(content, "confirmedAt");
  if (
    revision === null ||
    revision < 1 ||
    typeof updatedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(updatedByPubkey) ||
    updatedAt === null ||
    (confirmed !== undefined && !parseBriefContent(confirmed)) ||
    (pending !== undefined && !parseBriefContent(pending)) ||
    (confirmedByPubkey !== undefined &&
      (typeof confirmedByPubkey !== "string" ||
        !PUBKEY_PATTERN.test(confirmedByPubkey))) ||
    (confirmedAt !== undefined &&
      (typeof confirmedAt !== "number" ||
        !Number.isSafeInteger(confirmedAt) ||
        confirmedAt < 0))
  ) {
    return null;
  }
  return {
    revision,
    confirmed: confirmed === undefined ? null : parseBriefContent(confirmed),
    pending: pending === undefined ? null : parseBriefContent(pending),
    confirmedByPubkey:
      typeof confirmedByPubkey === "string" ? confirmedByPubkey : null,
    confirmedAt: typeof confirmedAt === "number" ? confirmedAt : null,
    updatedByPubkey,
    updatedAt,
    eventId: event.id,
  };
}

function parseAccountRequest(value: unknown): AccountRequest | null {
  if (!isObject(value) || !hasOnlyKeys(value, ["id", "label", "url"]))
    return null;
  const id = pick(value, "id");
  const label = pick(value, "label");
  const url = pick(value, "url");
  if (
    typeof id !== "string" ||
    !ACCOUNT_ID_PATTERN.test(id) ||
    !isText(label, 80) ||
    (url !== undefined &&
      (typeof url !== "string" ||
        !url.startsWith("https://") ||
        url.length > 300))
  ) {
    return null;
  }
  return { id, label, ...(typeof url === "string" ? { url } : {}) };
}

function parseMapEntry(value: unknown): OnboardingMapEntry | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["function", "placement", "leadPubkey"])
  )
    return null;
  const functionId = pick(value, "function");
  const placement = pick(value, "placement");
  const leadPubkey = pick(value, "leadPubkey");
  if (
    typeof functionId !== "string" ||
    !FUNCTION_IDS.has(functionId) ||
    (placement !== "existing_agent" &&
      placement !== "scout" &&
      placement !== "empty") ||
    (placement === "existing_agent" &&
      (typeof leadPubkey !== "string" || !PUBKEY_PATTERN.test(leadPubkey))) ||
    (placement !== "existing_agent" && leadPubkey !== undefined)
  ) {
    return null;
  }
  return {
    function: functionId as FunctionId,
    placement,
    ...(typeof leadPubkey === "string" ? { leadPubkey } : {}),
  };
}

function parseOnboardingMap(value: unknown): OnboardingMap | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["entries", "firstFunction", "approved"])
  )
    return null;
  const entries = pick(value, "entries");
  const firstFunction = pick(value, "firstFunction");
  const approved = pick(value, "approved");
  if (
    !Array.isArray(entries) ||
    entries.length !== FUNCTION_ORDER.length ||
    typeof firstFunction !== "string" ||
    !FUNCTION_IDS.has(firstFunction) ||
    typeof approved !== "boolean"
  ) {
    return null;
  }
  const parsedEntries = entries.map(parseMapEntry);
  if (
    parsedEntries.some((entry) => entry === null) ||
    parsedEntries.some(
      (entry, index) => entry?.function !== FUNCTION_ORDER[index],
    )
  ) {
    return null;
  }
  return {
    entries: parsedEntries as OnboardingMapEntry[],
    firstFunction: firstFunction as FunctionId,
    approved,
  };
}

export function parseOnboardingHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): OnboardingHead | null {
  if (
    !isValidRelayHead(event, relaySelfPubkey, KIND_ONBOARDING_HEAD) ||
    event.tags.length !== 1 ||
    oneTagValue(event, "d") !== ONBOARDING_D_TAG
  ) {
    return null;
  }
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "revision",
      "status",
      "leadPubkey",
      "steps",
      "question",
      "accounts",
      "map",
      "startedAt",
      "resumedAt",
      "resumeCount",
      "completedAt",
      "updatedByPubkey",
      "updatedAt",
    ]) ||
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION
  ) {
    return null;
  }
  const revision = readNumber(content, "revision");
  const status = pick(content, "status");
  const leadPubkey = pick(content, "leadPubkey");
  const rawSteps = pick(content, "steps");
  const rawQuestion = pick(content, "question");
  const rawAccounts = pick(content, "accounts");
  const rawMap = pick(content, "map");
  const startedAt = readNumber(content, "startedAt");
  const resumedAt = pick(content, "resumedAt");
  const resumeCount = readNumber(content, "resumeCount");
  const completedAt = pick(content, "completedAt");
  const updatedByPubkey = pick(content, "updatedByPubkey");
  const updatedAt = readNumber(content, "updatedAt");
  if (
    revision === null ||
    revision < 1 ||
    (status !== "in_progress" && status !== "complete") ||
    typeof leadPubkey !== "string" ||
    !PUBKEY_PATTERN.test(leadPubkey) ||
    !Array.isArray(rawSteps) ||
    rawSteps.length !== ONBOARDING_STEPS.length ||
    !Array.isArray(rawAccounts) ||
    rawAccounts.length > 8 ||
    startedAt === null ||
    resumeCount === null ||
    typeof updatedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(updatedByPubkey) ||
    updatedAt === null ||
    (resumedAt !== undefined &&
      (typeof resumedAt !== "number" ||
        !Number.isSafeInteger(resumedAt) ||
        resumedAt < 0)) ||
    (completedAt !== undefined &&
      (typeof completedAt !== "number" ||
        !Number.isSafeInteger(completedAt) ||
        completedAt < 0))
  ) {
    return null;
  }
  const steps = rawSteps.map((step) => {
    if (!isObject(step) || !hasOnlyKeys(step, ["step", "state"])) return null;
    const stepId = pick(step, "step");
    const state = pick(step, "state");
    if (
      typeof stepId !== "string" ||
      !ONBOARDING_STEPS.includes(stepId as OnboardingStep) ||
      (state !== "todo" &&
        state !== "asked" &&
        state !== "done" &&
        state !== "skipped")
    ) {
      return null;
    }
    return { step: stepId as OnboardingStep, state };
  });
  const accounts = rawAccounts.map((account) => {
    if (
      !isObject(account) ||
      !hasOnlyKeys(account, ["id", "label", "url", "state"])
    )
      return null;
    const request = parseAccountRequest({
      id: pick(account, "id"),
      label: pick(account, "label"),
      ...(pick(account, "url") === undefined
        ? {}
        : { url: pick(account, "url") }),
    });
    const state = pick(account, "state");
    return request &&
      (state === "asked" || state === "done" || state === "skipped")
      ? { ...request, state }
      : null;
  });
  let question: OnboardingHead["question"] = null;
  if (rawQuestion !== undefined) {
    if (
      !isObject(rawQuestion) ||
      !hasOnlyKeys(rawQuestion, ["step", "text", "account"])
    )
      return null;
    const step = pick(rawQuestion, "step");
    const text = pick(rawQuestion, "text");
    const account = pick(rawQuestion, "account");
    const parsedAccount =
      account === undefined ? null : parseAccountRequest(account);
    if (
      typeof step !== "string" ||
      !ONBOARDING_STEPS.includes(step as OnboardingStep) ||
      !isText(text, 200) ||
      (account !== undefined && !parsedAccount) ||
      (step === "accounts") !== (account !== undefined)
    ) {
      return null;
    }
    question = {
      step: step as OnboardingStep,
      text,
      ...(parsedAccount ? { account: parsedAccount } : {}),
    };
  }
  const map = rawMap === undefined ? null : parseOnboardingMap(rawMap);
  if (
    steps.some(
      (step, index) => step === null || step.step !== ONBOARDING_STEPS[index],
    ) ||
    accounts.some((account) => account === null) ||
    (rawMap !== undefined && !map)
  ) {
    return null;
  }
  return {
    revision,
    status,
    leadPubkey,
    steps: steps as Array<{ step: OnboardingStep; state: OnboardingStepState }>,
    question,
    accounts: accounts as OnboardingAccount[],
    map,
    startedAt,
    resumedAt: typeof resumedAt === "number" ? resumedAt : null,
    resumeCount,
    completedAt: typeof completedAt === "number" ? completedAt : null,
    updatedByPubkey,
    updatedAt,
    eventId: event.id,
  };
}

export type BriefActionInput =
  | {
      kind: "propose" | "edit";
      content: BriefContent;
      expectedHeadEventId?: string | null;
    }
  | { kind: "confirm" | "discard"; expectedHeadEventId?: string | null };

export function buildBriefActionEvent(input: BriefActionInput): {
  content: string;
  tags: string[][];
} {
  return {
    content: JSON.stringify({
      schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
      kind: input.kind,
      ...("content" in input ? { content: input.content } : {}),
      ...(input.expectedHeadEventId
        ? { expectedHeadEventId: input.expectedHeadEventId }
        : {}),
    }),
    tags: [["d", BRIEF_D_TAG]],
  };
}

export type OnboardingActionInput =
  | {
      kind: "answer";
      step: Exclude<OnboardingStep, "map">;
      skipped?: boolean;
      moneyPreference?: MoneyPreference;
      approvalSwitches?: ApprovalSwitches;
      expectedHeadEventId: string;
    }
  | {
      kind: "approve_map" | "reject_map" | "complete";
      expectedHeadEventId: string;
    };

export function buildOnboardingActionEvent(input: OnboardingActionInput): {
  content: string;
  tags: string[][];
} {
  return {
    content: JSON.stringify({
      schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
      kind: input.kind,
      ...(input.kind === "answer"
        ? {
            step: input.step,
            ...(input.skipped ? { skipped: true } : {}),
            ...(input.moneyPreference
              ? { moneyPreference: input.moneyPreference }
              : {}),
            ...(input.approvalSwitches
              ? { approvalSwitches: input.approvalSwitches }
              : {}),
          }
        : {}),
      expectedHeadEventId: input.expectedHeadEventId,
    }),
    tags: [["d", ONBOARDING_D_TAG]],
  };
}
