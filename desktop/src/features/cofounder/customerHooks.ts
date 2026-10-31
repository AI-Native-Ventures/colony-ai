import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";

import { buildCustomerActionEvent } from "./customerActions";
import type { CustomerActionInput } from "./customerActions";
import {
  KIND_CUSTOMER_ACTION,
  KIND_CUSTOMER_HEAD,
  buildCustomerRecords,
  parseCustomerHead,
} from "./customerRecords";
import type { CustomerRecordView } from "./customerRecords";

export const customerRecordsQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-customer-records", communityId, relayUrl] as const;

async function fetchCustomerRecords(): Promise<CustomerRecordView[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_CUSTOMER_HEAD],
    authors: [relaySelf],
    limit: 1_000,
  });
  const parsed: CustomerRecordView[] = [];
  for (const event of events) {
    const record = parseCustomerHead(event, relaySelf);
    if (record) parsed.push(record);
  }
  return buildCustomerRecords(parsed);
}

/** Every customer record of the company, listed by business name. */
export function useCustomerRecords(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: customerRecordsQueryKey(communityId, relayUrl),
    queryFn: fetchCustomerRecords,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The record of one business, or null while it has none. */
export function useCustomerRecord(partyId: string | null) {
  const records = useCustomerRecords(partyId !== null);
  const record = useMemo<CustomerRecordView | null>(
    () =>
      records.data?.find((candidate) => candidate.partyId === partyId) ?? null,
    [records.data, partyId],
  );
  return { ...records, record };
}

/** One mutation for every customer record write: sign, publish, refresh the list. */
export function useCustomerRecordAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: CustomerActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildCustomerActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_CUSTOMER_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the customer record.",
        "Failed to save the customer record.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: customerRecordsQueryKey(communityId, relayUrl),
      });
    },
  });
}
