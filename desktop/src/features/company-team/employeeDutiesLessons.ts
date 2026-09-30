import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_DUTY_ACTION,
  KIND_DUTY_HEAD,
  KIND_LESSON_ACTION,
  KIND_LESSON_HEAD,
} from "@/shared/constants/kinds";

const HEAD_QUERY_LIMIT = 500;
const HEX64_RE = /^[0-9a-f]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DutyProposal = {
  schemaVersion: 1;
  dutyId: string;
  employeePubkey: string;
  title: string;
  scheduleText: string;
  scheduleCron: string;
  timeZone: string;
  channelId: string;
  instructions: string;
};

export type DutyHead = {
  schemaVersion: 1;
  dutyId: string;
  proposal: DutyProposal;
  status: "active" | "paused" | "deleted";
  proposedByPubkey: string;
  approvedByPubkey: string;
  approvedAt: string;
  sourceAskId: string;
  sourceAskChannelId: string;
  workflowDefinitionHash: string;
  createdAt: string;
  updatedAt: string;
  sourceActionEventId: string;
};

export type DutyHeadRecord = { event: RelayEvent; head: DutyHead };

export type LessonEvidenceRef = {
  eventId: string;
  assessment?: "helpful" | "harmful";
};

export type LessonSnapshot = {
  schemaVersion: 1;
  lessonId: string;
  employeePubkey: string;
  lesson: string;
  evidence: LessonEvidenceRef[];
  confidence: "unassessed" | "low" | "moderate" | "high";
};

export type LessonHead = {
  schemaVersion: 1;
  lessonId: string;
  snapshot: LessonSnapshot;
  status: "candidate" | "approved" | "deprecated";
  proposedByPubkey: string;
  approval?: { approvedByPubkey: string; approvedAt: string };
  createdAt: string;
  updatedAt: string;
  sourceActionEventId: string;
};

export type LessonHeadRecord = { event: RelayEvent; head: LessonHead };

export type DutyAction = {
  schemaVersion: 1;
  dutyId: string;
  action: "update" | "pause" | "resume" | "delete";
  expectedHeadEventId: string;
  proposal?: DutyProposal;
};

export type LessonAction = {
  schemaVersion: 1;
  lessonId: string;
  action: "create" | "update" | "approve" | "deprecate" | "restore_candidate";
  expectedHeadEventId?: string;
  snapshot?: LessonSnapshot;
  confidence?: "low" | "moderate" | "high";
};

const employeeDutiesKey = (relayUrl: string | null, employeePubkey: string) =>
  ["employee-duties", relayUrl, employeePubkey] as const;
const employeeLessonsKey = (relayUrl: string | null, employeePubkey: string) =>
  ["employee-lessons", relayUrl, employeePubkey] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseDutyProposal(value: unknown): DutyProposal {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "dutyId",
      "employeePubkey",
      "title",
      "scheduleText",
      "scheduleCron",
      "timeZone",
      "channelId",
      "instructions",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.dutyId !== "string" ||
    !UUID_RE.test(value.dutyId) ||
    typeof value.employeePubkey !== "string" ||
    !HEX64_RE.test(value.employeePubkey) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.scheduleText !== "string" ||
    !value.scheduleText.trim() ||
    typeof value.scheduleCron !== "string" ||
    typeof value.timeZone !== "string" ||
    typeof value.channelId !== "string" ||
    !UUID_RE.test(value.channelId) ||
    typeof value.instructions !== "string" ||
    !value.instructions.trim()
  ) {
    throw new Error("The relay returned an invalid duty proposal.");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
  } catch {
    throw new Error("The relay returned a duty with an invalid timezone.");
  }
  return value as unknown as DutyProposal;
}

export function parseDutyHead(value: unknown): DutyHead {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "dutyId",
      "proposal",
      "status",
      "proposedByPubkey",
      "approvedByPubkey",
      "approvedAt",
      "sourceAskId",
      "sourceAskChannelId",
      "workflowDefinitionHash",
      "createdAt",
      "updatedAt",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.dutyId !== "string" ||
    !UUID_RE.test(value.dutyId) ||
    !"active paused deleted".split(" ").includes(String(value.status)) ||
    typeof value.proposedByPubkey !== "string" ||
    !HEX64_RE.test(value.proposedByPubkey) ||
    typeof value.approvedByPubkey !== "string" ||
    !HEX64_RE.test(value.approvedByPubkey) ||
    !isIsoTime(value.approvedAt) ||
    typeof value.sourceAskId !== "string" ||
    !UUID_RE.test(value.sourceAskId) ||
    typeof value.sourceAskChannelId !== "string" ||
    !UUID_RE.test(value.sourceAskChannelId) ||
    typeof value.workflowDefinitionHash !== "string" ||
    !HEX64_RE.test(value.workflowDefinitionHash) ||
    !isIsoTime(value.createdAt) ||
    !isIsoTime(value.updatedAt) ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    throw new Error("The relay returned an invalid duty head.");
  }
  const proposal = parseDutyProposal(value.proposal);
  if (proposal.dutyId !== value.dutyId) {
    throw new Error("The relay returned a duty head with mismatched identity.");
  }
  if (
    validateReadableDutySchedule(proposal.scheduleText) !==
    proposal.scheduleCron
  ) {
    throw new Error("The relay returned a mismatched duty schedule.");
  }
  return { ...value, proposal } as DutyHead;
}

function parseLessonSnapshot(value: unknown): LessonSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "lessonId",
      "employeePubkey",
      "lesson",
      "evidence",
      "confidence",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.lessonId !== "string" ||
    !UUID_RE.test(value.lessonId) ||
    typeof value.employeePubkey !== "string" ||
    !HEX64_RE.test(value.employeePubkey) ||
    typeof value.lesson !== "string" ||
    !value.lesson.trim() ||
    !Array.isArray(value.evidence) ||
    value.evidence.length < 1 ||
    value.evidence.length > 100 ||
    !["unassessed", "low", "moderate", "high"].includes(
      String(value.confidence),
    )
  ) {
    throw new Error("The relay returned an invalid lesson snapshot.");
  }
  const seen = new Set<string>();
  const evidence = value.evidence.map((reference) => {
    if (
      !isRecord(reference) ||
      !exactKeys(reference, ["eventId", "assessment"]) ||
      typeof reference.eventId !== "string" ||
      !HEX64_RE.test(reference.eventId) ||
      (reference.assessment !== undefined &&
        reference.assessment !== "helpful" &&
        reference.assessment !== "harmful") ||
      seen.has(reference.eventId)
    ) {
      throw new Error(
        "The relay returned an invalid lesson evidence reference.",
      );
    }
    seen.add(reference.eventId);
    return reference as LessonEvidenceRef;
  });
  return { ...value, evidence } as LessonSnapshot;
}

export function parseLessonHead(value: unknown): LessonHead {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "lessonId",
      "snapshot",
      "status",
      "proposedByPubkey",
      "approval",
      "createdAt",
      "updatedAt",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.lessonId !== "string" ||
    !UUID_RE.test(value.lessonId) ||
    !["candidate", "approved", "deprecated"].includes(String(value.status)) ||
    typeof value.proposedByPubkey !== "string" ||
    !HEX64_RE.test(value.proposedByPubkey) ||
    !isIsoTime(value.createdAt) ||
    !isIsoTime(value.updatedAt) ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    throw new Error("The relay returned an invalid lesson head.");
  }
  const snapshot = parseLessonSnapshot(value.snapshot);
  if (snapshot.lessonId !== value.lessonId) {
    throw new Error(
      "The relay returned a lesson head with mismatched identity.",
    );
  }
  let approval: LessonHead["approval"];
  if (value.approval !== undefined) {
    if (
      !isRecord(value.approval) ||
      !exactKeys(value.approval, ["approvedByPubkey", "approvedAt"]) ||
      typeof value.approval.approvedByPubkey !== "string" ||
      !HEX64_RE.test(value.approval.approvedByPubkey) ||
      !isIsoTime(value.approval.approvedAt)
    ) {
      throw new Error("The relay returned invalid lesson approval provenance.");
    }
    approval = value.approval as LessonHead["approval"];
  }
  if (
    (value.status === "candidate" &&
      (snapshot.confidence !== "unassessed" || approval !== undefined)) ||
    (value.status === "approved" &&
      (snapshot.confidence === "unassessed" || approval === undefined)) ||
    (value.status === "deprecated" &&
      approval !== undefined &&
      snapshot.confidence === "unassessed")
  ) {
    throw new Error("The relay returned inconsistent lesson approval state.");
  }
  return {
    ...value,
    snapshot,
    ...(approval ? { approval } : {}),
  } as LessonHead;
}

export function decodeEmployeeHead<T>(
  event: RelayEvent,
  kind: number,
  dTag: string,
  employeePubkey: string,
  relaySelf: string,
  parse: (value: unknown) => T,
): T {
  if (
    event.kind !== kind ||
    event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
    !verifyEvent(event)
  ) {
    throw new Error("The relay returned an invalid employee record event.");
  }
  const dTags = event.tags.filter((tag) => tag[0] === "d").map((tag) => tag[1]);
  const pTags = event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);
  if (
    event.tags.length !== 2 ||
    dTags.length !== 1 ||
    dTags[0] !== dTag ||
    pTags.length !== 1 ||
    pTags[0] !== employeePubkey ||
    event.tags.some((tag) => tag[0] === "h")
  ) {
    throw new Error("The employee record tags do not match their owner.");
  }
  let content: unknown;
  try {
    content = JSON.parse(event.content) as unknown;
  } catch {
    throw new Error("The relay returned malformed employee record content.");
  }
  return parse(content);
}

export function decodeEmployeeRecordHead<T>(input: {
  event: RelayEvent;
  kind: number;
  dTag: string;
  employeePubkey: string;
  relaySelf: string;
  parseHead: (value: unknown) => T;
  getId: (head: T) => string;
  expectedId: string;
  getEmployeePubkey: (head: T) => string;
}): T {
  const head = decodeEmployeeHead(
    input.event,
    input.kind,
    input.dTag,
    input.employeePubkey,
    input.relaySelf,
    input.parseHead,
  );
  if (
    input.getId(head) !== input.expectedId ||
    input.getEmployeePubkey(head).toLowerCase() !==
      input.employeePubkey.toLowerCase()
  ) {
    throw new Error("The relay returned a head with mismatched identity.");
  }
  return head;
}

async function fetchEmployeeHeads<T>(input: {
  employeePubkey: string;
  kind: number;
  parseHead: (value: unknown) => T;
  dTag: (id: string) => string;
  getId: (head: T) => string;
  getEmployeePubkey: (head: T) => string;
}): Promise<Array<{ event: RelayEvent; head: T }>> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const events = await relayClient.fetchEvents({
    kinds: [input.kind],
    authors: [relaySelf],
    "#p": [input.employeePubkey],
    limit: HEAD_QUERY_LIMIT + 1,
  });
  if (events.length > HEAD_QUERY_LIMIT) {
    throw new Error("Employee records exceed the supported read limit.");
  }
  const records = events.map((event) => {
    let raw: unknown;
    try {
      raw = JSON.parse(event.content) as unknown;
    } catch {
      throw new Error("The relay returned malformed employee record content.");
    }
    if (!isRecord(raw)) {
      throw new Error("The relay returned an invalid employee record head.");
    }
    const id = input.kind === KIND_DUTY_HEAD ? raw.dutyId : raw.lessonId;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw new Error(
        "The relay returned an invalid employee record identity.",
      );
    }
    const dTag = input.dTag(id);
    const head = decodeEmployeeRecordHead({
      event,
      kind: input.kind,
      dTag,
      employeePubkey: input.employeePubkey,
      relaySelf,
      parseHead: input.parseHead,
      getId: input.getId,
      expectedId: id,
      getEmployeePubkey: input.getEmployeePubkey,
    });
    return { event, head };
  });
  const ids = records.map((record) => input.getId(record.head));
  if (new Set(ids).size !== ids.length) {
    throw new Error("The relay returned duplicate employee record heads.");
  }
  return records;
}

function useEmployeeRecordSubscription(input: {
  enabled: boolean;
  employeePubkey: string;
  kind: number;
  key: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const scopeToken = `${relayUrl ?? "no-relay"}|${input.employeePubkey}|${input.kind}`;
  const currentScopeRef = React.useRef(scopeToken);
  currentScopeRef.current = scopeToken;
  const [subscriptionState, setSubscriptionState] = React.useState<{
    scope: string;
    error: Error | null;
  }>({ scope: scopeToken, error: null });
  React.useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    if (!input.enabled || !relayUrl || !HEX64_RE.test(input.employeePubkey)) {
      return;
    }
    setSubscriptionState({ scope: scopeToken, error: null });
    const setLiveError = (error: unknown) => {
      if (disposed || currentScopeRef.current !== scopeToken) return;
      setSubscriptionState({
        scope: scopeToken,
        error:
          error instanceof Error
            ? error
            : new Error("The employee record subscription failed."),
      });
    };
    const unsubscribeReconnect = relayClient.subscribeToReconnects(() => {
      if (disposed || currentScopeRef.current !== scopeToken) return;
      void queryClient.invalidateQueries({ queryKey: input.key });
    });
    void getRelaySelf()
      .then((relaySelf) => {
        if (!relaySelf) {
          throw new Error("This relay does not advertise a signing identity.");
        }
        if (disposed || currentScopeRef.current !== scopeToken) return null;
        return relayClient.subscribeLive(
          {
            kinds: [input.kind],
            authors: [relaySelf],
            "#p": [input.employeePubkey],
            limit: 0,
          },
          () => {
            if (disposed || currentScopeRef.current !== scopeToken) return;
            void queryClient.invalidateQueries({ queryKey: input.key });
          },
        );
      })
      .then((close) => {
        if (!close) return;
        if (disposed || currentScopeRef.current !== scopeToken) {
          void close();
          return;
        }
        unsubscribe = close;
        void queryClient.invalidateQueries({ queryKey: input.key });
      })
      .catch(setLiveError);
    return () => {
      disposed = true;
      unsubscribeReconnect();
      if (unsubscribe) void unsubscribe().catch(setLiveError);
    };
  }, [
    input.employeePubkey,
    input.enabled,
    input.key,
    input.kind,
    queryClient,
    relayUrl,
    scopeToken,
  ]);
  return subscriptionState.scope === scopeToken
    ? subscriptionState.error
    : null;
}

export function useEmployeeDutiesQuery(employeePubkey: string, enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalizedEmployee = employeePubkey.toLowerCase();
  const key = React.useMemo(
    () => employeeDutiesKey(relayUrl, normalizedEmployee),
    [normalizedEmployee, relayUrl],
  );
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const records = await fetchEmployeeHeads({
        employeePubkey: normalizedEmployee,
        kind: KIND_DUTY_HEAD,
        parseHead: parseDutyHead,
        dTag: (id) => `company:duty:${id}`,
        getId: (head) => head.dutyId,
        getEmployeePubkey: (head) => head.proposal.employeePubkey,
      });
      return records
        .filter((record) => record.head.status !== "deleted")
        .sort((a, b) =>
          a.head.proposal.title.localeCompare(b.head.proposal.title),
        );
    },
    enabled: enabled && relayUrl !== null && HEX64_RE.test(normalizedEmployee),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const subscriptionError = useEmployeeRecordSubscription({
    enabled: enabled && relayUrl !== null,
    employeePubkey: normalizedEmployee,
    kind: KIND_DUTY_HEAD,
    key,
  });
  return { ...query, subscriptionError };
}

export function useEmployeeLessonsQuery(
  employeePubkey: string,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalizedEmployee = employeePubkey.toLowerCase();
  const key = React.useMemo(
    () => employeeLessonsKey(relayUrl, normalizedEmployee),
    [normalizedEmployee, relayUrl],
  );
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const records = await fetchEmployeeHeads({
        employeePubkey: normalizedEmployee,
        kind: KIND_LESSON_HEAD,
        parseHead: parseLessonHead,
        dTag: (id) => `company:lesson:${id}`,
        getId: (head) => head.lessonId,
        getEmployeePubkey: (head) => head.snapshot.employeePubkey,
      });
      return records.sort(
        (a, b) => Date.parse(b.head.updatedAt) - Date.parse(a.head.updatedAt),
      );
    },
    enabled: enabled && relayUrl !== null && HEX64_RE.test(normalizedEmployee),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const subscriptionError = useEmployeeRecordSubscription({
    enabled: enabled && relayUrl !== null,
    employeePubkey: normalizedEmployee,
    kind: KIND_LESSON_HEAD,
    key,
  });
  return { ...query, subscriptionError };
}

export function useDutyActionMutation(employeePubkey: string) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: DutyAction) => {
      if (!relayUrl) throw new Error("No active community is selected.");
      const event = await signRelayEvent({
        kind: KIND_DUTY_ACTION,
        content: JSON.stringify(action),
        tags: [
          ["d", `company:duty:${action.dutyId}`],
          ["p", employeePubkey],
        ],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the employee duty.",
        "Failed to save the employee duty.",
      );
      return event;
    },
    onSettled: async () => {
      if (relayUrl) {
        await queryClient.invalidateQueries({
          queryKey: employeeDutiesKey(relayUrl, employeePubkey.toLowerCase()),
        });
      }
    },
  });
}

export function useLessonActionMutation(employeePubkey: string) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: LessonAction) => {
      if (!relayUrl) throw new Error("No active community is selected.");
      const event = await signRelayEvent({
        kind: KIND_LESSON_ACTION,
        content: JSON.stringify(action),
        tags: [
          ["d", `company:lesson:${action.lessonId}`],
          ["p", employeePubkey],
        ],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the employee lesson.",
        "Failed to save the employee lesson.",
      );
      return event;
    },
    onSettled: async () => {
      if (relayUrl) {
        await queryClient.invalidateQueries({
          queryKey: employeeLessonsKey(relayUrl, employeePubkey.toLowerCase()),
        });
      }
    },
  });
}

export function validateReadableDutySchedule(schedule: string): string | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "every") return null;
  const day = parts[1]?.toLowerCase();
  if (parts.length === 7) {
    const [hour, minute] = (parts[6] ?? "").split(":").map(Number);
    if (
      day !== "month" ||
      parts[2]?.toLowerCase() !== "on" ||
      parts[3]?.toLowerCase() !== "day" ||
      parts[5]?.toLowerCase() !== "at" ||
      !/^\d+$/.test(parts[4] ?? "") ||
      Number(parts[4]) < 1 ||
      Number(parts[4]) > 31 ||
      !/^\d{2}:\d{2}$/.test(parts[6] ?? "") ||
      hour === undefined ||
      minute === undefined ||
      hour > 23 ||
      minute > 59
    ) {
      return null;
    }
    return `${minute} ${hour} ${Number(parts[4])} * *`;
  }
  if (parts.length < 3) return null;
  let time: string | undefined;
  if (parts.length === 4 && parts[2]?.toLowerCase() === "at") time = parts[3];
  else if (parts.length === 3) time = parts[2];
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59)
    return null;
  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  if (parts.length !== 4 && parts.length !== 3) return null;
  if (day === "day") return `${minute} ${hour} * * *`;
  if (day === "weekday") return `${minute} ${hour} * * 1-5`;
  if (weekdays.includes(day ?? ""))
    return `${minute} ${hour} * * ${weekdays.indexOf(day ?? "")}`;
  return null;
}

export function dutyDTag(dutyId: string) {
  return `company:duty:${dutyId}`;
}

export function lessonDTag(lessonId: string) {
  return `company:lesson:${lessonId}`;
}
