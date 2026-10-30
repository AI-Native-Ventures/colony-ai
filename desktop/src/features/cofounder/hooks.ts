import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

import { buildFunctionSlotViews } from "./functions";
import {
  COFOUNDER_D_TAG,
  DEFAULT_COFOUNDER_SETTINGS,
  KIND_COFOUNDER_ACTION,
  KIND_COFOUNDER_HEAD,
  KIND_COMPANY_FUNCTION_HEAD,
  KIND_WORKER_RUN_HEAD,
  COMPANY_RECORD_SCHEMA_VERSION,
  companyFunctionDTag,
  parseCofounderSettingsHead,
  parseCompanyFunctionHead,
  parseWorkerRunHead,
} from "./cofounderRecords";
import type {
  CofounderSettings,
  CofounderSettingsView,
  CompanyFunctionHead,
  FunctionId,
  FunctionSlotView,
  WorkerRun,
} from "./cofounderRecords";

function compareNewest(first: RelayEvent, second: RelayEvent): number {
  return (
    second.created_at - first.created_at || first.id.localeCompare(second.id)
  );
}

function requireRelaySelf(relaySelf: string | null): string {
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  return relaySelf;
}

export const cofounderSettingsQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["cofounder-settings", communityId, relayUrl] as const;

export async function fetchCofounderSettings(): Promise<CofounderSettingsView> {
  const relaySelf = requireRelaySelf(await getRelaySelf());
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COFOUNDER_HEAD],
    authors: [relaySelf],
    "#d": [COFOUNDER_D_TAG],
    limit: 20,
  });
  const head = [...events]
    .sort(compareNewest)
    .map((event) => parseCofounderSettingsHead(event, relaySelf))
    .find((record) => record !== null);
  return head
    ? { exists: true, eventId: head.eventId, settings: head.settings }
    : { exists: false, eventId: null, settings: DEFAULT_COFOUNDER_SETTINGS };
}

export function useCofounderSettingsQuery(communityId: string | null) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: Boolean(
      communityId && relayUrl && activeCommunity?.id === communityId,
    ),
    queryKey: cofounderSettingsQueryKey(communityId, relayUrl),
    queryFn: fetchCofounderSettings,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export type SetCofounderSettingsInput = {
  settings: CofounderSettings;
  expectedHeadEventId: string | null;
};

export function useSetCofounderSettings() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;

  return useMutation({
    mutationFn: async ({
      settings,
      expectedHeadEventId,
    }: SetCofounderSettingsInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const event = await signRelayEvent({
        kind: KIND_COFOUNDER_ACTION,
        content: JSON.stringify({
          schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
          settings,
          ...(expectedHeadEventId ? { expectedHeadEventId } : {}),
        }),
        tags: [["d", COFOUNDER_D_TAG]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving co-founder settings.",
        "Failed to save co-founder settings.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: cofounderSettingsQueryKey(communityId, relayUrl),
      });
    },
  });
}

async function fetchCompanyFunctionHeads(): Promise<CompanyFunctionHead[]> {
  const relaySelf = requireRelaySelf(await getRelaySelf());
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_FUNCTION_HEAD],
    authors: [relaySelf],
    limit: 200,
  });
  const heads = [...events]
    .sort(compareNewest)
    .map((event) => parseCompanyFunctionHead(event, relaySelf))
    .filter((record): record is NonNullable<typeof record> => record !== null);
  const latestByFunction = new Map<FunctionId, CompanyFunctionHead>();
  for (const head of heads) {
    if (!latestByFunction.has(head.functionId))
      latestByFunction.set(head.functionId, head);
  }
  return [...latestByFunction.values()];
}

export function useFunctionSlotsQuery(
  communityId: string | null,
): FunctionSlotView[] {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const enabled = Boolean(
    communityId && relayUrl && activeCommunity?.id === communityId,
  );
  const headsQuery = useQuery({
    enabled,
    queryKey: ["company-function-heads", communityId, relayUrl],
    queryFn: fetchCompanyFunctionHeads,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const teamQuery = useCompanyTeamQuery(enabled);
  return useMemo(
    () =>
      buildFunctionSlotViews(
        headsQuery.data ?? [],
        teamQuery.data?.members ?? [],
      ),
    [headsQuery.data, teamQuery.data?.members],
  );
}

/**
 * Worker runs of one employee, or every employee's runs when `all` is set
 * (the Company Work page). Runs stay visible even when no lead owns the
 * function, so Scout's runs are never hidden.
 */
export function useWorkerRunsQuery(
  parentPubkey: string | null,
  { all = false }: { all?: boolean } = {},
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const communityId = activeCommunity?.id ?? null;
  const normalizedParentPubkey = all
    ? null
    : (parentPubkey?.toLowerCase() ?? null);
  return useQuery({
    enabled: Boolean(
      (all || normalizedParentPubkey) && communityId && relayUrl,
    ),
    queryKey: [
      "company-worker-runs",
      communityId,
      relayUrl,
      all ? "all" : normalizedParentPubkey,
    ],
    queryFn: async (): Promise<WorkerRun[]> => {
      if (!all && !normalizedParentPubkey) return [];
      const relaySelf = requireRelaySelf(await getRelaySelf());
      const events = await relayClient.fetchEvents({
        kinds: [KIND_WORKER_RUN_HEAD],
        authors: [relaySelf],
        ...(normalizedParentPubkey ? { "#p": [normalizedParentPubkey] } : {}),
        limit: 1_000,
      });
      const latestByWorker = new Map<
        string,
        { run: WorkerRun; event: RelayEvent }
      >();
      for (const event of events) {
        const run = parseWorkerRunHead(event, relaySelf);
        if (!run) continue;
        if (
          normalizedParentPubkey &&
          run.parentPubkey !== normalizedParentPubkey
        )
          continue;
        const current = latestByWorker.get(run.workerId);
        if (!current || compareNewest(event, current.event) < 0) {
          latestByWorker.set(run.workerId, { run, event });
        }
      }
      return [...latestByWorker.values()]
        .map(({ run }) => run)
        .sort((first, second) => second.startedAt - first.startedAt);
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export { companyFunctionDTag };
