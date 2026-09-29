import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_HIRE_ACTION, KIND_HIRE_HEAD } from "@/shared/constants/kinds";
import {
  companyHireDTag,
  COMPANY_HIRE_HEAD_QUERY_LIMIT,
  parseCompanyHireHeadEvent,
  type CompanyHireAction,
  type CompanyHireHeadRecord,
} from "./companyHireModels";

const HIRE_HEAD_REFETCH_INTERVAL_MS = 15_000;

export const companyHireHeadQueryKey = (
  relayUrl: string | null,
  hireId: string,
) => ["company-hire-head", relayUrl, hireId.toLowerCase()] as const;

async function fetchCompanyHireHead(
  hireId: string,
  relaySelfPubkey: string,
): Promise<CompanyHireHeadRecord | null> {
  const dTag = companyHireDTag(hireId);
  const events = await relayClient.fetchEvents({
    kinds: [KIND_HIRE_HEAD],
    authors: [relaySelfPubkey],
    "#d": [dTag],
    limit: COMPANY_HIRE_HEAD_QUERY_LIMIT,
  });
  const matching = events.filter(
    (event) => event.tags.filter((tag) => tag[0] === "d")[0]?.[1] === dTag,
  );
  if (matching.length > 1) {
    throw new Error("The relay returned duplicate current hire heads.");
  }
  const event = matching[0];
  if (!event) return null;
  const record = parseCompanyHireHeadEvent(event, relaySelfPubkey, hireId);
  if (!record) {
    throw new Error("The relay returned an invalid signed hire head.");
  }
  return record;
}

export function useCompanyHireHeadQuery(hireId: string | null) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalizedId = hireId?.toLowerCase() ?? null;
  const query = useQuery({
    enabled: relayUrl !== null && normalizedId !== null,
    queryKey: companyHireHeadQueryKey(relayUrl, normalizedId ?? ""),
    queryFn: async () => {
      if (!normalizedId) throw new Error("The hire coordinate is missing.");
      const relaySelf = await getRelaySelf();
      if (!relaySelf) {
        throw new Error("This relay does not advertise a signing identity.");
      }
      return fetchCompanyHireHead(normalizedId, relaySelf);
    },
    staleTime: 5_000,
    refetchInterval: HIRE_HEAD_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  return query;
}

export function useCompanyHireActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: CompanyHireAction) => {
      const event = await signRelayEvent({
        kind: KIND_HIRE_ACTION,
        content: JSON.stringify(action),
        tags: [["d", companyHireDTag(action.hireId)]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the hire.",
        "The hire could not be saved.",
      );
      return event;
    },
    onSettled: async (_data, _error, action) => {
      if (!action) return;
      await queryClient.invalidateQueries({
        queryKey: companyHireHeadQueryKey(relayUrl, action.hireId),
      });
    },
  });
}
