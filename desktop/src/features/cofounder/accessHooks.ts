import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

import {
  KIND_COMPANY_ACCESS_ACTION,
  KIND_COMPANY_ACCESS_HEAD,
  buildAccessActionEvent,
  buildAccessRows,
  buildGapNeedsYouItems,
  parseAccessHead,
  parseCapabilityGapHead,
  parseSlotHireHead,
} from "./accessRecords";
import type {
  AccessActionInput,
  AccessHead,
  AccessRow,
  CapabilityGapHead,
  GapNeedsYouItem,
  SlotHireHead,
} from "./accessRecords";

export type CompanyAccessData = {
  access: AccessHead[];
  gaps: CapabilityGapHead[];
  slotHires: SlotHireHead[];
};

const EMPTY_ACCESS: CompanyAccessData = { access: [], gaps: [], slotHires: [] };

function dTagOf(event: RelayEvent): string {
  return event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
}

export const companyAccessQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-access", communityId, relayUrl] as const;

/** Reads every access entry, capability gap and slot hire head, newest per record. */
export async function fetchCompanyAccess(): Promise<CompanyAccessData> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_ACCESS_HEAD],
    authors: [relaySelf],
    limit: 500,
  });
  const newestFirst = [...events].sort(
    (first, second) =>
      second.created_at - first.created_at || first.id.localeCompare(second.id),
  );
  const seen = new Set<string>();
  const data: CompanyAccessData = { access: [], gaps: [], slotHires: [] };
  for (const event of newestFirst) {
    const dTag = dTagOf(event);
    if (seen.has(dTag)) continue;
    const access = parseAccessHead(event, relaySelf);
    const gap = access ? null : parseCapabilityGapHead(event, relaySelf);
    const slotHire = access || gap ? null : parseSlotHireHead(event, relaySelf);
    if (!access && !gap && !slotHire) continue;
    seen.add(dTag);
    if (access) data.access.push(access);
    if (gap) data.gaps.push(gap);
    if (slotHire) data.slotHires.push(slotHire);
  }
  return data;
}

export function useCompanyAccessQuery(communityId: string | null) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: Boolean(
      communityId && relayUrl && activeCommunity?.id === communityId,
    ),
    queryKey: companyAccessQueryKey(communityId, relayUrl),
    queryFn: fetchCompanyAccess,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/** The access list screen rows: Colony-run tools first, then every other entry. */
export function useAccessRows(communityId: string | null): {
  rows: AccessRow[];
  isLoading: boolean;
} {
  const query = useCompanyAccessQuery(communityId);
  const rows = useMemo(
    () => buildAccessRows((query.data ?? EMPTY_ACCESS).access),
    [query.data],
  );
  return { rows, isLoading: query.isLoading };
}

/**
 * Capability gaps that need the owner, as Needs you items: `approve` while the
 * stated cost waits for approval, `do` while the one human step is next.
 */
export function useGapNeedsYouItems(communityId: string | null): {
  items: GapNeedsYouItem[];
  isLoading: boolean;
} {
  const query = useCompanyAccessQuery(communityId);
  const items = useMemo(
    () => buildGapNeedsYouItems((query.data ?? EMPTY_ACCESS).gaps),
    [query.data],
  );
  return { items, isLoading: query.isLoading };
}

/** Signs and publishes one access, capability gap or slot hire write. */
export function usePublishAccessAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;

  return useMutation({
    mutationFn: async (input: AccessActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildAccessActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_COMPANY_ACCESS_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the access change.",
        "Failed to save the access change.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: companyAccessQueryKey(communityId, relayUrl),
      });
    },
  });
}
