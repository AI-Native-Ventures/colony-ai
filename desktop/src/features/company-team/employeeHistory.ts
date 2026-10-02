import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_EMPLOYEE_REVISION_ACTION,
  KIND_EMPLOYEE_REVISION_HEAD,
} from "@/shared/constants/kinds";

export type EmployeeConfigSnapshot = {
  instructions?: string;
  provider?: string;
  model?: string;
  runtime?: string;
};

export type EmployeeRevisionAction = {
  schemaVersion: 1;
  employeePubkey: string;
  action: "record" | "undo";
  expectedHeadEventId?: string;
  previousRevisionEventId?: string;
  before: EmployeeConfigSnapshot;
  after: EmployeeConfigSnapshot;
  undoOfEventId?: string;
};

export type EmployeeRevisionHead = {
  schemaVersion: 1;
  employeePubkey: string;
  revisionEventId: string;
  previousRevisionEventId?: string;
  snapshot: EmployeeConfigSnapshot;
  actorPubkey: string;
  updatedAt: string;
  sourceActionEventId: string;
};

export type EmployeeRevision = {
  event: RelayEvent;
  action: EmployeeRevisionAction;
};

export type PendingEmployeeRevision = {
  pendingId: string;
  actorPubkey: string;
  action: EmployeeRevisionAction;
};

export type EmployeeHistory = {
  employeePubkey: string;
  headEvent: RelayEvent | null;
  head: EmployeeRevisionHead | null;
  revisions: EmployeeRevision[];
};

const EMPLOYEE_REVISION_QUERY_LIMIT = 1_000;
const HEX64_RE = /^[0-9a-f]{64}$/;
const employeeHistoryQueryKey = (employeePubkey: string) =>
  ["company-employee-history", employeePubkey] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseSnapshot(value: unknown): EmployeeConfigSnapshot | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["instructions", "provider", "model", "runtime"])
  ) {
    return null;
  }
  for (const key of ["instructions", "provider", "model", "runtime"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "string") return null;
    if (
      key === "instructions"
        ? item.length > 20_000
        : item.trim().length === 0 || item.length > 256
    ) {
      return null;
    }
  }
  return {
    ...(typeof value.instructions === "string"
      ? { instructions: value.instructions }
      : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.runtime === "string" ? { runtime: value.runtime } : {}),
  };
}

function sameSnapshot(
  first: EmployeeConfigSnapshot,
  second: EmployeeConfigSnapshot,
) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function employeeHistoryDTag(employeePubkey: string) {
  const normalized = employeePubkey.toLowerCase();
  if (!HEX64_RE.test(normalized))
    throw new Error("Employee pubkey is invalid.");
  return `company:employee-history:${normalized}`;
}

function eventTagValues(event: RelayEvent, tagName: string) {
  return event.tags.filter((tag) => tag[0] === tagName).map((tag) => tag[1]);
}

function parseActionEvent(
  event: RelayEvent,
  employeePubkey: string,
  dTag: string,
): EmployeeRevision {
  if (event.kind !== KIND_EMPLOYEE_REVISION_ACTION || !verifyEvent(event)) {
    throw new Error("The relay returned an invalid employee revision event.");
  }
  const dTags = eventTagValues(event, "d");
  const pTags = eventTagValues(event, "p");
  if (
    event.tags.length !== 2 ||
    dTags.length !== 1 ||
    dTags[0] !== dTag ||
    pTags.length !== 1 ||
    pTags[0] !== employeePubkey
  ) {
    throw new Error("The employee revision tags do not match this employee.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(event.content) as unknown;
  } catch {
    throw new Error("The relay returned malformed employee revision content.");
  }
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      "schemaVersion",
      "employeePubkey",
      "action",
      "expectedHeadEventId",
      "previousRevisionEventId",
      "before",
      "after",
      "undoOfEventId",
    ]) ||
    raw.schemaVersion !== 1 ||
    raw.employeePubkey !== employeePubkey ||
    (raw.action !== "record" && raw.action !== "undo") ||
    (raw.expectedHeadEventId !== undefined &&
      (typeof raw.expectedHeadEventId !== "string" ||
        !HEX64_RE.test(raw.expectedHeadEventId))) ||
    (raw.previousRevisionEventId !== undefined &&
      (typeof raw.previousRevisionEventId !== "string" ||
        !HEX64_RE.test(raw.previousRevisionEventId))) ||
    (raw.expectedHeadEventId === undefined) !==
      (raw.previousRevisionEventId === undefined) ||
    (raw.undoOfEventId !== undefined &&
      (typeof raw.undoOfEventId !== "string" ||
        !HEX64_RE.test(raw.undoOfEventId))) ||
    (raw.action === "record" && raw.undoOfEventId !== undefined) ||
    (raw.action === "undo" &&
      (raw.expectedHeadEventId === undefined ||
        raw.undoOfEventId === undefined))
  ) {
    throw new Error("The relay returned an invalid employee revision action.");
  }
  const before = parseSnapshot(raw.before);
  const after = parseSnapshot(raw.after);
  if (!before || !after || sameSnapshot(before, after)) {
    throw new Error(
      "The employee revision has an invalid configuration snapshot.",
    );
  }
  return {
    event,
    action: {
      schemaVersion: 1,
      employeePubkey,
      action: raw.action,
      ...(typeof raw.expectedHeadEventId === "string"
        ? { expectedHeadEventId: raw.expectedHeadEventId }
        : {}),
      ...(typeof raw.previousRevisionEventId === "string"
        ? { previousRevisionEventId: raw.previousRevisionEventId }
        : {}),
      before,
      after,
      ...(typeof raw.undoOfEventId === "string"
        ? { undoOfEventId: raw.undoOfEventId }
        : {}),
    },
  };
}

function parseHeadEvent(
  event: RelayEvent,
  employeePubkey: string,
  relaySelf: string,
  dTag: string,
): EmployeeRevisionHead {
  if (
    event.kind !== KIND_EMPLOYEE_REVISION_HEAD ||
    event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
    !verifyEvent(event)
  ) {
    throw new Error("The relay returned an invalid employee history head.");
  }
  const dTags = eventTagValues(event, "d");
  if (event.tags.length !== 1 || dTags.length !== 1 || dTags[0] !== dTag) {
    throw new Error("The employee history head has an invalid coordinate.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(event.content) as unknown;
  } catch {
    throw new Error(
      "The relay returned malformed employee history head content.",
    );
  }
  if (
    !isRecord(raw) ||
    !exactKeys(raw, [
      "schemaVersion",
      "employeePubkey",
      "revisionEventId",
      "previousRevisionEventId",
      "snapshot",
      "actorPubkey",
      "updatedAt",
      "sourceActionEventId",
    ]) ||
    raw.schemaVersion !== 1 ||
    raw.employeePubkey !== employeePubkey ||
    typeof raw.revisionEventId !== "string" ||
    !HEX64_RE.test(raw.revisionEventId) ||
    (raw.previousRevisionEventId !== undefined &&
      (typeof raw.previousRevisionEventId !== "string" ||
        !HEX64_RE.test(raw.previousRevisionEventId))) ||
    typeof raw.actorPubkey !== "string" ||
    !HEX64_RE.test(raw.actorPubkey) ||
    typeof raw.updatedAt !== "string" ||
    Number.isNaN(Date.parse(raw.updatedAt)) ||
    typeof raw.sourceActionEventId !== "string" ||
    !HEX64_RE.test(raw.sourceActionEventId)
  ) {
    throw new Error("The relay returned an invalid employee history head.");
  }
  const snapshot = parseSnapshot(raw.snapshot);
  if (!snapshot)
    throw new Error("The employee history head has an invalid snapshot.");
  return {
    schemaVersion: 1,
    employeePubkey,
    revisionEventId: raw.revisionEventId,
    ...(typeof raw.previousRevisionEventId === "string"
      ? { previousRevisionEventId: raw.previousRevisionEventId }
      : {}),
    snapshot,
    actorPubkey: raw.actorPubkey,
    updatedAt: raw.updatedAt,
    sourceActionEventId: raw.sourceActionEventId,
  };
}

export async function fetchEmployeeHistory(
  employeePubkey: string,
): Promise<EmployeeHistory> {
  const employee = employeePubkey.toLowerCase();
  const dTag = employeeHistoryDTag(employee);
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const [actions, heads] = await Promise.all([
    relayClient.fetchEvents({
      kinds: [KIND_EMPLOYEE_REVISION_ACTION],
      "#d": [dTag],
      "#p": [employee],
      limit: EMPLOYEE_REVISION_QUERY_LIMIT + 1,
    }),
    relayClient.fetchEvents({
      kinds: [KIND_EMPLOYEE_REVISION_HEAD],
      authors: [relaySelf],
      "#d": [dTag],
      limit: 2,
    }),
  ]);
  if (actions.length > EMPLOYEE_REVISION_QUERY_LIMIT) {
    throw new Error("Employee history exceeds the supported read limit.");
  }
  if (heads.length > 1)
    throw new Error("The relay returned duplicate employee history heads.");
  const revisionsById = new Map<string, EmployeeRevision>();
  for (const event of actions) {
    const revision = parseActionEvent(event, employee, dTag);
    if (revisionsById.has(revision.event.id)) {
      throw new Error("The relay returned a duplicate employee revision.");
    }
    revisionsById.set(revision.event.id, revision);
  }
  const headEvent = heads[0] ?? null;
  const head = headEvent
    ? parseHeadEvent(headEvent, employee, relaySelf, dTag)
    : null;
  const reverse: EmployeeRevision[] = [];
  let nextId = head?.revisionEventId;
  const visited = new Set<string>();
  while (nextId) {
    if (visited.has(nextId))
      throw new Error("Employee history contains a cycle.");
    visited.add(nextId);
    const revision = revisionsById.get(nextId);
    if (!revision)
      throw new Error("Employee history head references a missing revision.");
    revisionsById.delete(nextId);
    reverse.push(revision);
    nextId = revision.action.previousRevisionEventId;
  }
  if (revisionsById.size > 0) {
    throw new Error(
      "The relay returned revisions outside the employee history chain.",
    );
  }
  const revisions = reverse.reverse();
  for (let index = 1; index < revisions.length; index += 1) {
    const previous = revisions[index - 1];
    const current = revisions[index];
    if (
      !previous ||
      !current ||
      !sameSnapshot(previous.action.after, current.action.before)
    ) {
      throw new Error(
        "Employee history contains a broken configuration transition.",
      );
    }
  }
  for (const revision of revisions) {
    if (revision.action.action !== "undo") continue;
    const undoTarget = revisions.find(
      (candidate) => candidate.event.id === revision.action.undoOfEventId,
    );
    if (
      !undoTarget ||
      !sameSnapshot(undoTarget.action.before, revision.action.after)
    ) {
      throw new Error("Employee history contains an invalid undo revision.");
    }
  }
  const latest = revisions.at(-1);
  if (head && latest) {
    if (
      head.revisionEventId !== latest.event.id ||
      head.sourceActionEventId !== latest.event.id ||
      head.previousRevisionEventId !== latest.action.previousRevisionEventId ||
      head.actorPubkey !== latest.event.pubkey ||
      !sameSnapshot(head.snapshot, latest.action.after)
    ) {
      throw new Error(
        "Employee history head does not match its latest revision.",
      );
    }
  } else if (head || revisions.length > 0) {
    throw new Error("Employee history head and revision actions do not match.");
  }
  return { employeePubkey: employee, headEvent, head, revisions };
}

export function useEmployeeHistoryQuery(employeePubkey: string) {
  return useQuery({
    queryKey: employeeHistoryQueryKey(employeePubkey.toLowerCase()),
    queryFn: () => fetchEmployeeHistory(employeePubkey),
    enabled: HEX64_RE.test(employeePubkey.toLowerCase()),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useRecordEmployeeRevisionMutation(employeePubkey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: EmployeeRevisionAction) => {
      if (action.employeePubkey !== employeePubkey.toLowerCase()) {
        throw new Error("Employee revision target changed. Refresh and retry.");
      }
      const event = await signRelayEvent({
        kind: KIND_EMPLOYEE_REVISION_ACTION,
        content: JSON.stringify(action),
        tags: [
          ["d", employeeHistoryDTag(action.employeePubkey)],
          ["p", action.employeePubkey],
        ],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving employee history.",
        "Failed to save employee history.",
      );
      return event;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: employeeHistoryQueryKey(employeePubkey.toLowerCase()),
      });
    },
  });
}
