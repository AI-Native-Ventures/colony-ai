import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { channelsQueryKey } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useTenantCommunityId } from "@/features/communities/useTenantCommunityId";
import { resolveBusinessChannel } from "@/features/discovery/businessRecordRelay";
import { relayClient } from "@/shared/api/relayClient";
import { getChannels } from "@/shared/api/tauriChannels";
import type { Channel } from "@/shared/api/types";

import {
  leadHeadFilter,
  leadReferenceView,
  newestLeadHead,
  type LeadReferenceView,
} from "./leadReferenceModel";

const LEAD_REFERENCE_STALE_MS = 30_000;

/**
 * The private Sales stream that holds the business records. It reads the
 * channel list the app already keeps, so a message full of lead cards opens no
 * extra channel subscriptions.
 */
export function useBusinessChannelId(enabled = true) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const communityId = activeCommunity?.id ?? null;
  return useQuery({
    queryKey: [
      "lead-reference-business-channel",
      relayUrl ?? "unavailable",
      communityId ?? "unavailable",
    ],
    enabled: enabled && Boolean(activeCommunity),
    staleTime: LEAD_REFERENCE_STALE_MS,
    queryFn: async () => {
      const cached = queryClient.getQueryData<Channel[]>(channelsQueryKey);
      return resolveBusinessChannel(
        cached ?? (await getChannels(null)).channels ?? [],
      );
    },
  });
}

/**
 * One lead's head, read once and cached: no live subscription, so a long
 * channel full of lead cards stays cheap. Window focus and the 30 second
 * stale time keep the card current enough for a chat reference.
 */
export function useLeadReference(leadId: string): {
  view: LeadReferenceView;
  retry: () => void;
} {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  // The lead's coordinate is namespaced by the relay's tenant id, which the
  // relay itself has to confirm; the local community id would never match.
  const tenant = useTenantCommunityId(relayUrl);
  const communityId = tenant.tenantId;
  const channel = useBusinessChannelId();
  const channelId = channel.data ?? null;
  const head = useQuery({
    queryKey: [
      "lead-reference",
      relayUrl ?? "unavailable",
      communityId ?? "unavailable",
      leadId,
    ],
    enabled: Boolean(communityId && channelId),
    staleTime: LEAD_REFERENCE_STALE_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!communityId || !channelId) return null;
      return newestLeadHead(
        await relayClient.fetchEvents(
          leadHeadFilter(channelId, communityId, leadId),
        ),
      );
    },
  });

  const { refetch: refetchChannel } = channel;
  const { refetch: refetchHead } = head;
  const { retry: retryTenant } = tenant;
  const retry = React.useCallback(() => {
    void retryTenant()
      .then(() => refetchChannel())
      .then(() => refetchHead());
  }, [refetchChannel, refetchHead, retryTenant]);

  if (tenant.error) {
    return {
      view: leadReferenceView({
        isPending: false,
        error: tenant.error,
        head: null,
      }),
      retry,
    };
  }
  if (channel.error) {
    return {
      view: leadReferenceView({
        isPending: false,
        error: channel.error,
        head: null,
      }),
      retry,
    };
  }
  // No Sales stream means no leads at all: the reference cannot resolve.
  if (channel.isSuccess && channelId === null) {
    return { view: { kind: "missing" }, retry };
  }
  return {
    view: leadReferenceView({
      isPending: channel.isPending || tenant.pending || head.isPending,
      error: head.error,
      head: head.data,
    }),
    retry,
  };
}
