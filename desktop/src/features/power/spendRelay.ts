import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import type { TeamMember } from "@/features/company-team/teamModels";
import { readArchivedEvents } from "@/shared/api/tauriArchive";
import { relayClient } from "@/shared/api/relayClient";
import { useIdentityQuery } from "@/shared/api/hooks";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_AI_SPEND_RECORD_ACTION,
  KIND_AI_SPEND_RECORD_HEAD,
  KIND_AGENT_TURN_METRIC,
  KIND_EMPLOYEE_AI_ALLOWANCE_ACTION,
  KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
} from "@/shared/constants/kinds";

import {
  allowanceActionTags,
  COMPANY_SPEND_HEAD_QUERY_LIMIT,
  parseAgentTurnPayload,
  parseAiSpendRecordHeadEvent,
  parseEmployeeAllowanceHeadEvent,
  spendActionTags,
  type AiSpendRecordAction,
  type AiSpendRecordHeadRecord,
  type EmployeeAllowanceAction,
  type EmployeeAllowanceHeadRecord,
} from "./spendModels";

const SPEND_REPORT_PAGE_SIZE = 100;
const SPEND_REPORT_PAGE_LIMIT = 40;
const SPEND_REPORT_LOOKBACK_SECONDS = 32 * 24 * 60 * 60;

export const employeeAllowanceHeadsQueryKey = (relayUrl: string | null) =>
  ["employee-ai-allowances", relayUrl] as const;
export const aiSpendHeadsQueryKey = (relayUrl: string | null) =>
  ["ai-spend-records", relayUrl] as const;

async function fetchEmployeeAllowanceHeads(): Promise<{
  relaySelf: string;
  records: EmployeeAllowanceHeadRecord[];
}> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const events = await relayClient.fetchEvents({
    kinds: [KIND_EMPLOYEE_AI_ALLOWANCE_HEAD],
    authors: [relaySelf],
    limit: COMPANY_SPEND_HEAD_QUERY_LIMIT,
  });
  if (events.length >= COMPANY_SPEND_HEAD_QUERY_LIMIT) {
    throw new Error(
      "The employee allowance list exceeds the supported read limit.",
    );
  }
  return {
    relaySelf,
    records: events.map((event) => {
      const parsed = parseEmployeeAllowanceHeadEvent(event, relaySelf);
      if (!parsed)
        throw new Error("The relay returned an invalid employee allowance.");
      return parsed;
    }),
  };
}

async function fetchAiSpendHeads(): Promise<{
  relaySelf: string;
  records: AiSpendRecordHeadRecord[];
}> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const events = await relayClient.fetchEvents({
    kinds: [KIND_AI_SPEND_RECORD_HEAD],
    authors: [relaySelf],
    limit: COMPANY_SPEND_HEAD_QUERY_LIMIT,
  });
  if (events.length >= COMPANY_SPEND_HEAD_QUERY_LIMIT) {
    throw new Error(
      "The AI spend record list exceeds the supported read limit.",
    );
  }
  return {
    relaySelf,
    records: events.map((event) => {
      const parsed = parseAiSpendRecordHeadEvent(event, relaySelf);
      if (!parsed)
        throw new Error("The relay returned an invalid AI spend record.");
      return parsed;
    }),
  };
}

export function useEmployeeAllowanceHeadsQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: employeeAllowanceHeadsQueryKey(relayUrl),
    queryFn: fetchEmployeeAllowanceHeads,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useAiSpendHeadsQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: aiSpendHeadsQueryKey(relayUrl),
    queryFn: fetchAiSpendHeads,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useEmployeeAllowanceMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: EmployeeAllowanceAction) => {
      const event = await signRelayEvent({
        kind: KIND_EMPLOYEE_AI_ALLOWANCE_ACTION,
        content: JSON.stringify(action),
        tags: allowanceActionTags(action),
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the employee allowance.",
        "Failed to save the employee allowance.",
      );
      return event;
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: employeeAllowanceHeadsQueryKey(relayUrl),
      }),
  });
}

export function useAiSpendRecordMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: AiSpendRecordAction) => {
      const event = await signRelayEvent({
        kind: KIND_AI_SPEND_RECORD_ACTION,
        content: JSON.stringify(action),
        tags: spendActionTags(action),
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the AI spend record.",
        "Failed to save the AI spend record.",
      );
      return event;
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: aiSpendHeadsQueryKey(relayUrl),
      }),
  });
}

/**
 * Copies owner-addressed local 44200 reports into the durable company ledger.
 * The archived report remains the retry source if publishing fails. The
 * attempt set prevents this effect from spinning on the same failed record;
 * reopening the app retries it from the archive.
 */
export function useSyncAgentTurnSpendRecords(
  employees: TeamMember[],
  spendQuery: ReturnType<typeof useAiSpendHeadsQuery>,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const attemptedRef = React.useRef(new Set<string>());
  const identityQuery = useIdentityQuery();
  const ownerPubkey = identityQuery.data?.pubkey.toLowerCase() ?? "";
  const employeePubkeys = React.useMemo(
    () =>
      new Set(
        employees
          .filter((member) => member.kind === "employee")
          .map((member) => member.pubkey.toLowerCase()),
      ),
    [employees],
  );
  const reportsQuery = useQuery({
    enabled: enabled && Boolean(ownerPubkey) && employeePubkeys.size > 0,
    queryKey: ["owner-agent-turn-spend-reports", relayUrl, ownerPubkey],
    queryFn: () => readRecentAgentTurnReports(ownerPubkey),
    staleTime: 15_000,
    retry: false,
  });
  const records = spendQuery.data?.records ?? [];
  const presentSourceIds = React.useMemo(
    () =>
      new Set(
        records.flatMap((item) =>
          item.head.record.recordType === "agent_turn"
            ? [item.head.record.sourceUsageEventId]
            : [],
        ),
      ),
    [records],
  );
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (
      !enabled ||
      !ownerPubkey ||
      !reportsQuery.data ||
      spendQuery.isLoading ||
      spendQuery.isError
    )
      return;
    let cancelled = false;
    const sync = async () => {
      setSyncError(null);
      for (const report of reportsQuery.data) {
        if (cancelled) return;
        const sourceId = report.id;
        if (
          presentSourceIds.has(sourceId) ||
          !employeePubkeys.has(report.pubkey.toLowerCase())
        )
          continue;
        const parsed = parseAgentTurnPayload(report, ownerPubkey);
        if (!parsed) continue;
        const attemptKey = `${ownerPubkey}:${sourceId}`;
        if (attemptedRef.current.has(attemptKey)) continue;
        attemptedRef.current.add(attemptKey);
        const action: AiSpendRecordAction = {
          schemaVersion: 1,
          recordId: `usage:${sourceId}`,
          action: "record",
          record: {
            recordType: "agent_turn",
            employeePubkey: parsed.employeePubkey,
            ...(parsed.model ? { model: parsed.model } : {}),
            sourceUsageEventId: sourceId,
            ...(parsed.estimatedAmountNanoUsd !== undefined
              ? { estimatedAmountNanoUsd: parsed.estimatedAmountNanoUsd }
              : {}),
            isEstimate: true,
            sourceOfFunds: "unknown",
            reportedAt: parsed.reportedAt,
          },
        };
        try {
          const event = await signRelayEvent({
            kind: KIND_AI_SPEND_RECORD_ACTION,
            content: JSON.stringify(action),
            tags: spendActionTags(action),
          });
          await relayClient.publishEvent(
            event,
            "Timed out saving a reported AI turn.",
            "Failed to save a reported AI turn.",
          );
        } catch (error) {
          setSyncError(
            error instanceof Error
              ? error.message
              : "A reported AI turn could not be saved.",
          );
          return;
        }
      }
      await queryClient.invalidateQueries({
        queryKey: aiSpendHeadsQueryKey(relayUrl),
      });
    };
    void sync();
    return () => {
      cancelled = true;
    };
  }, [
    employeePubkeys,
    enabled,
    ownerPubkey,
    presentSourceIds,
    queryClient,
    relayUrl,
    reportsQuery.data,
    spendQuery.isError,
    spendQuery.isLoading,
  ]);

  return {
    error: reportsQuery.error ?? (syncError ? new Error(syncError) : null),
  };
}

async function readRecentAgentTurnReports(
  ownerPubkey: string,
): Promise<RelayEvent[]> {
  const cutoff = Math.floor(Date.now() / 1000) - SPEND_REPORT_LOOKBACK_SECONDS;
  const rows: RelayEvent[] = [];
  let before: { createdAt: number; id: string } | null = null;
  for (let page = 0; page < SPEND_REPORT_PAGE_LIMIT; page += 1) {
    const batch = await readArchivedEvents("owner_p", ownerPubkey, {
      kinds: [KIND_AGENT_TURN_METRIC],
      before,
      limit: SPEND_REPORT_PAGE_SIZE,
    });
    rows.push(...batch.filter((event) => event.created_at >= cutoff));
    const last = batch.at(-1);
    if (
      !last ||
      batch.length < SPEND_REPORT_PAGE_SIZE ||
      last.created_at < cutoff
    ) {
      return rows;
    }
    before = { createdAt: last.created_at, id: last.id };
  }
  throw new Error(
    "Too many local AI turn reports are waiting for spend-ledger sync.",
  );
}
