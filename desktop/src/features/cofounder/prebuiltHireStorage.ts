import type { FunctionId } from "./cofounderRecords";

export type PrebuiltHireChoice = {
  runtimeId: string;
  providerId: string;
  modelId: string;
  effortLevel?: string;
};

export type PrebuiltHireProgress = {
  hireId: string;
  functionId: FunctionId;
  agentId: string;
  introductionChannelId: string;
  choice: PrebuiltHireChoice;
  employeePubkey?: string;
  introductionEventId?: string;
  directChannelId?: string;
  firstMessageEventId?: string;
};

/**
 * The short-lived map state that lets the owner reopen the direct chat after
 * a successful first message. It is deliberately scoped to one community and
 * one part, just like an unfinished hire recovery record.
 */
export type PrebuiltHireCompletion = {
  hireId: string;
  functionId: FunctionId;
  agentId: string;
  employeePubkey: string;
  directChannelId: string;
  firstMessageEventId: string;
  firstMessage: string;
};

const CHOICE_KEY_PREFIX = "company-map-prebuilt-choice:v1:";
const PROGRESS_KEY_PREFIX = "company-map-prebuilt-progress:v1:";
const COMPLETION_KEY_PREFIX = "company-map-prebuilt-completion:v1:";
const FUNCTION_IDS = new Set<FunctionId>([
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
]);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function choiceKey(communityId: string) {
  return `${CHOICE_KEY_PREFIX}${communityId}`;
}

function progressKey(communityId: string, functionId: FunctionId) {
  return `${PROGRESS_KEY_PREFIX}${communityId}:${functionId}`;
}

function completionKey(communityId: string, functionId: FunctionId) {
  return `${COMPLETION_KEY_PREFIX}${communityId}:${functionId}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseChoice(value: unknown): PrebuiltHireChoice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "runtimeId" &&
        key !== "providerId" &&
        key !== "modelId" &&
        key !== "effortLevel",
    ) ||
    !nonEmptyString(record.runtimeId) ||
    typeof record.providerId !== "string" ||
    !nonEmptyString(record.modelId) ||
    (record.effortLevel !== undefined && !nonEmptyString(record.effortLevel))
  ) {
    return null;
  }
  return {
    runtimeId: record.runtimeId.trim(),
    providerId: record.providerId.trim(),
    modelId: record.modelId.trim(),
    ...(typeof record.effortLevel === "string"
      ? { effortLevel: record.effortLevel.trim() }
      : {}),
  };
}

function readJson(key: string): unknown {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readPrebuiltHireChoice(
  communityId: string | null | undefined,
): PrebuiltHireChoice | null {
  if (!communityId) return null;
  return parseChoice(readJson(choiceKey(communityId)));
}

export function writePrebuiltHireChoice(
  communityId: string | null | undefined,
  choice: PrebuiltHireChoice,
) {
  if (!communityId || !parseChoice(choice)) return false;
  return writeJson(choiceKey(communityId), choice);
}

export function readPrebuiltHireProgress(
  communityId: string | null | undefined,
  functionId: FunctionId,
): PrebuiltHireProgress | null {
  if (!communityId) return null;
  const raw = readJson(progressKey(communityId, functionId));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const choice = parseChoice(record.choice);
  if (
    Object.keys(record).some(
      (key) =>
        key !== "hireId" &&
        key !== "functionId" &&
        key !== "agentId" &&
        key !== "introductionChannelId" &&
        key !== "choice" &&
        key !== "employeePubkey" &&
        key !== "introductionEventId" &&
        key !== "directChannelId" &&
        key !== "firstMessageEventId" &&
        key !== "firstMoveEventId",
    ) ||
    !nonEmptyString(record.hireId) ||
    record.functionId !== functionId ||
    !FUNCTION_IDS.has(record.functionId as FunctionId) ||
    !nonEmptyString(record.agentId) ||
    !nonEmptyString(record.introductionChannelId) ||
    !choice ||
    (record.employeePubkey !== undefined &&
      !nonEmptyString(record.employeePubkey)) ||
    (record.introductionEventId !== undefined &&
      !nonEmptyString(record.introductionEventId)) ||
    (record.directChannelId !== undefined &&
      !nonEmptyString(record.directChannelId)) ||
    (record.firstMessageEventId !== undefined &&
      !nonEmptyString(record.firstMessageEventId)) ||
    (record.firstMoveEventId !== undefined &&
      !nonEmptyString(record.firstMoveEventId)) ||
    (record.firstMessageEventId !== undefined &&
      record.firstMoveEventId !== undefined)
  ) {
    return null;
  }
  return {
    hireId: record.hireId.trim(),
    functionId,
    agentId: record.agentId.trim(),
    introductionChannelId: record.introductionChannelId.trim(),
    choice,
    ...(typeof record.employeePubkey === "string"
      ? { employeePubkey: record.employeePubkey.trim() }
      : {}),
    ...(typeof record.introductionEventId === "string"
      ? { introductionEventId: record.introductionEventId.trim() }
      : {}),
    ...(typeof record.directChannelId === "string"
      ? { directChannelId: record.directChannelId.trim() }
      : {}),
    ...(typeof record.firstMessageEventId === "string"
      ? { firstMessageEventId: record.firstMessageEventId.trim() }
      : typeof record.firstMoveEventId === "string"
        ? { firstMessageEventId: record.firstMoveEventId.trim() }
        : {}),
  };
}

export function writePrebuiltHireProgress(
  communityId: string | null | undefined,
  progress: PrebuiltHireProgress,
) {
  if (!communityId || !readableProgress(progress)) return false;
  return writeJson(progressKey(communityId, progress.functionId), progress);
}

function readableProgress(value: PrebuiltHireProgress): boolean {
  return (
    nonEmptyString(value.hireId) &&
    FUNCTION_IDS.has(value.functionId) &&
    nonEmptyString(value.agentId) &&
    nonEmptyString(value.introductionChannelId) &&
    parseChoice(value.choice) !== null &&
    (value.employeePubkey === undefined ||
      nonEmptyString(value.employeePubkey)) &&
    (value.introductionEventId === undefined ||
      nonEmptyString(value.introductionEventId)) &&
    (value.directChannelId === undefined ||
      nonEmptyString(value.directChannelId)) &&
    (value.firstMessageEventId === undefined ||
      nonEmptyString(value.firstMessageEventId))
  );
}

function readableCompletion(value: PrebuiltHireCompletion): boolean {
  return (
    nonEmptyString(value.hireId) &&
    FUNCTION_IDS.has(value.functionId) &&
    nonEmptyString(value.agentId) &&
    nonEmptyString(value.employeePubkey) &&
    nonEmptyString(value.directChannelId) &&
    nonEmptyString(value.firstMessageEventId) &&
    nonEmptyString(value.firstMessage)
  );
}

export function readPrebuiltHireCompletion(
  communityId: string | null | undefined,
  functionId: FunctionId,
): PrebuiltHireCompletion | null {
  if (!communityId) return null;
  const raw = readJson(completionKey(communityId, functionId));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "hireId" &&
        key !== "functionId" &&
        key !== "agentId" &&
        key !== "employeePubkey" &&
        key !== "directChannelId" &&
        key !== "firstMessageEventId" &&
        key !== "firstMessage",
    ) ||
    record.functionId !== functionId ||
    !FUNCTION_IDS.has(record.functionId as FunctionId) ||
    !nonEmptyString(record.hireId) ||
    !nonEmptyString(record.agentId) ||
    !nonEmptyString(record.employeePubkey) ||
    !nonEmptyString(record.directChannelId) ||
    !nonEmptyString(record.firstMessageEventId) ||
    !nonEmptyString(record.firstMessage)
  ) {
    return null;
  }
  return {
    hireId: record.hireId.trim(),
    functionId,
    agentId: record.agentId.trim(),
    employeePubkey: record.employeePubkey.trim(),
    directChannelId: record.directChannelId.trim(),
    firstMessageEventId: record.firstMessageEventId.trim(),
    firstMessage: record.firstMessage.trim(),
  };
}

export function writePrebuiltHireCompletion(
  communityId: string | null | undefined,
  completion: PrebuiltHireCompletion,
) {
  if (!communityId || !readableCompletion(completion)) return false;
  return writeJson(
    completionKey(communityId, completion.functionId),
    completion,
  );
}

export function clearPrebuiltHireProgress(
  communityId: string | null | undefined,
  functionId: FunctionId,
) {
  if (!communityId) return;
  try {
    storage()?.removeItem(progressKey(communityId, functionId));
  } catch {
    // Local recovery is optional. A storage failure must not hide the hire UI.
  }
}
