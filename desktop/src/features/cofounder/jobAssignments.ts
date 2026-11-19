import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import {
  KIND_COMPANY_JOB_ACTION,
  KIND_COMPANY_JOB_HEAD,
} from "@/shared/constants/kinds";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { invokeTauri } from "@/shared/api/tauriTransport";
import type { RelayEvent } from "@/shared/api/types";

import {
  COMPANY_RECORD_SCHEMA_VERSION,
  type FunctionId,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  PUBKEY_PATTERN,
} from "./cofounderRecords";

export { KIND_COMPANY_JOB_ACTION, KIND_COMPANY_JOB_HEAD };

/** NIP-11 extension a relay advertises before the desktop sends job commands. */
export const JOB_ASSIGNMENT_EXTENSION = "colony-job-assignments";

export const COMPANY_JOB_D_TAG_PREFIX = "company:job:";
export const COMPANY_JOB_HIRE_D_TAG_PREFIX = "company:job-hire:";

const JOB_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type CompanyJobState = "empty" | "filled";

export type CompanyJobHead = {
  functionId: FunctionId;
  jobId: string;
  state: CompanyJobState;
  assigneePubkey: string | null;
  updatedByPubkey: string;
  updatedAt: number;
  eventId: string;
};

export type CompanyJobHireIntent = {
  hireId: string;
  functionId: FunctionId;
  jobId: string;
  eventId: string;
};

export type CompanyJobActionInput =
  | {
      action: "assign";
      functionId: FunctionId;
      jobId: string;
      assigneePubkey: string;
      expectedHeadEventId: string | null;
    }
  | {
      action: "clear";
      functionId: FunctionId;
      jobId: string;
      expectedHeadEventId: string | null;
    }
  | {
      action: "hire_set";
      functionId: FunctionId;
      jobId: string;
      hireId: string;
      expectedHeadEventId: string | null;
    };

function isFunctionId(value: unknown): value is FunctionId {
  return (
    value === "sales" ||
    value === "operations" ||
    value === "customer_success" ||
    value === "finance" ||
    value === "brand"
  );
}

export function isCompanyJobId(value: string): boolean {
  return value.length <= 40 && JOB_ID_PATTERN.test(value);
}

/** Stable, display-name-independent coordinate for one job's current assignee. */
export function companyJobDTag(functionId: FunctionId, jobId: string): string {
  if (!isCompanyJobId(jobId)) throw new Error("The job id is not valid.");
  return `${COMPANY_JOB_D_TAG_PREFIX}${functionId}:${jobId}`;
}

/** Stable coordinate for the job intent attached to one pending hire. */
export function companyJobHireDTag(hireId: string): string {
  if (!UUID_PATTERN.test(hireId)) throw new Error("The hire id is not valid.");
  return `${COMPANY_JOB_HIRE_D_TAG_PREFIX}${hireId.toLowerCase()}`;
}

function jobCoordinate(
  dTag: string,
): { functionId: FunctionId; jobId: string } | null {
  const value = dTag.startsWith(COMPANY_JOB_D_TAG_PREFIX)
    ? dTag.slice(COMPANY_JOB_D_TAG_PREFIX.length)
    : null;
  if (!value) return null;
  const divider = value.indexOf(":");
  if (divider < 1 || divider !== value.lastIndexOf(":")) return null;
  const functionId = value.slice(0, divider);
  const jobId = value.slice(divider + 1);
  return isFunctionId(functionId) && isCompanyJobId(jobId)
    ? { functionId, jobId }
    : null;
}

/** Strictly parses a relay-signed assignment head while ignoring hire intents. */
export function parseCompanyJobHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): CompanyJobHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_JOB_HEAD)) {
    return null;
  }
  const coordinate = jobCoordinate(oneTagValue(event, "d") ?? "");
  if (!coordinate) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "function",
      "jobId",
      "state",
      "assigneePubkey",
      "updatedByPubkey",
      "updatedAt",
    ])
  ) {
    return null;
  }
  const schemaVersion = content.schemaVersion;
  const functionId = content.function;
  const jobId = content.jobId;
  const state = content.state;
  const assigneePubkey = content.assigneePubkey;
  const updatedByPubkey = content.updatedByPubkey;
  const updatedAt = content.updatedAt;
  if (
    schemaVersion !== COMPANY_RECORD_SCHEMA_VERSION ||
    functionId !== coordinate.functionId ||
    jobId !== coordinate.jobId ||
    (state !== "empty" && state !== "filled") ||
    typeof updatedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(updatedByPubkey) ||
    typeof updatedAt !== "number" ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0
  ) {
    return null;
  }
  if (state === "filled") {
    if (
      typeof assigneePubkey !== "string" ||
      !PUBKEY_PATTERN.test(assigneePubkey)
    ) {
      return null;
    }
    return {
      ...coordinate,
      state,
      assigneePubkey,
      updatedByPubkey,
      updatedAt,
      eventId: event.id,
    };
  }
  if (assigneePubkey !== undefined) return null;
  return {
    ...coordinate,
    state,
    assigneePubkey: null,
    updatedByPubkey,
    updatedAt,
    eventId: event.id,
  };
}

/** Strictly parses a relay-signed pending-hire job intent. */
export function parseCompanyJobHireIntent(
  event: RelayEvent,
  relaySelfPubkey: string,
): CompanyJobHireIntent | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_JOB_HEAD)) {
    return null;
  }
  const dTag = oneTagValue(event, "d");
  const rawHireId = dTag?.startsWith(COMPANY_JOB_HIRE_D_TAG_PREFIX)
    ? dTag.slice(COMPANY_JOB_HIRE_D_TAG_PREFIX.length)
    : null;
  if (!rawHireId || !UUID_PATTERN.test(rawHireId)) return null;
  const hireId = rawHireId.toLowerCase();
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "hireId",
      "function",
      "jobId",
      "setByPubkey",
      "updatedAt",
    ]) ||
    content.schemaVersion !== COMPANY_RECORD_SCHEMA_VERSION ||
    content.hireId !== hireId ||
    !isFunctionId(content.function) ||
    typeof content.jobId !== "string" ||
    !isCompanyJobId(content.jobId) ||
    typeof content.setByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(content.setByPubkey) ||
    typeof content.updatedAt !== "number" ||
    !Number.isSafeInteger(content.updatedAt) ||
    content.updatedAt < 0
  ) {
    return null;
  }
  return {
    hireId,
    functionId: content.function,
    jobId: content.jobId,
    eventId: event.id,
  };
}

/** Builds the member-signed action and exact coordinate the relay verifies. */
export function buildCompanyJobActionEvent(input: CompanyJobActionInput): {
  content: string;
  tags: string[][];
} {
  const content = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    action: input.action,
    function: input.functionId,
    jobId: input.jobId,
    ...(input.action === "assign"
      ? { assigneePubkey: input.assigneePubkey }
      : {}),
    ...(input.action === "hire_set" ? { hireId: input.hireId } : {}),
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
  };
  const dTag =
    input.action === "hire_set"
      ? companyJobHireDTag(input.hireId)
      : companyJobDTag(input.functionId, input.jobId);
  return { content: JSON.stringify(content), tags: [["d", dTag]] };
}

function dTagOf(event: RelayEvent): string {
  return oneTagValue(event, "d") ?? "";
}

export const companyJobHeadsQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-job-heads", communityId, relayUrl] as const;

/**
 * Selects the newest valid assignment head for each job from relay events.
 * An older relay has no job records, which deliberately resolves to no
 * specialist assignments rather than a parsing or map failure.
 */
export function parseCompanyJobHeads(
  events: readonly RelayEvent[],
  relaySelfPubkey: string,
): CompanyJobHead[] {
  const newestFirst = [...events].sort(
    (first, second) =>
      second.created_at - first.created_at || first.id.localeCompare(second.id),
  );
  const seen = new Set<string>();
  const heads: CompanyJobHead[] = [];
  for (const event of newestFirst) {
    const dTag = dTagOf(event);
    if (seen.has(dTag)) continue;
    const head = parseCompanyJobHead(event, relaySelfPubkey);
    if (!head) continue;
    seen.add(dTag);
    heads.push(head);
  }
  return heads;
}

/** Reads newest valid head per job. A relay with no job records simply returns []. */
export async function fetchCompanyJobHeads(): Promise<CompanyJobHead[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_JOB_HEAD],
    authors: [relaySelf],
    limit: 500,
  });
  return parseCompanyJobHeads(events, relaySelf);
}

/** Reads the current job intent for one recoverable specialist hire. */
export async function fetchCompanyJobHireIntent(
  hireId: string,
): Promise<CompanyJobHireIntent | null> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const dTag = companyJobHireDTag(hireId);
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_JOB_HEAD],
    authors: [relaySelf],
    "#d": [dTag],
    limit: 2,
  });
  const newest = [...events].sort(
    (first, second) =>
      second.created_at - first.created_at || first.id.localeCompare(second.id),
  )[0];
  return newest ? parseCompanyJobHireIntent(newest, relaySelf) : null;
}

/** Fetches job heads only after the relay has advertised their additive protocol. */
export function useCompanyJobHeadsQuery(
  communityId: string | null,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: Boolean(
      enabled && communityId && relayUrl && activeCommunity?.id === communityId,
    ),
    queryKey: companyJobHeadsQueryKey(communityId, relayUrl),
    queryFn: fetchCompanyJobHeads,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * A missing extension is deliberately a safe, visible no: a new desktop must
 * never send job records to a relay released before this broker exists.
 */
export function useJobAssignmentCapability() {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: Boolean(activeCommunity?.id && relayUrl),
    queryKey: ["relay-extension", relayUrl, JOB_ASSIGNMENT_EXTENSION],
    queryFn: async () => {
      try {
        return Boolean(
          await invokeTauri<boolean>("relay_supports_extension", {
            extension: JOB_ASSIGNMENT_EXTENSION,
          }),
        );
      } catch {
        return false;
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Signs and publishes one owner or admin job command. */
export function usePublishCompanyJobAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: CompanyJobActionInput) => {
      if (!communityId || !relayUrl) {
        throw new Error("No active company is selected.");
      }
      const supported = await invokeTauri<boolean>("relay_supports_extension", {
        extension: JOB_ASSIGNMENT_EXTENSION,
      });
      if (!supported) {
        throw new Error(
          "Update this company relay before hiring or removing a specialist.",
        );
      }
      const { content, tags } = buildCompanyJobActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_COMPANY_JOB_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the job assignment.",
        "Failed to save the job assignment.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: companyJobHeadsQueryKey(communityId, relayUrl),
      });
    },
  });
}
