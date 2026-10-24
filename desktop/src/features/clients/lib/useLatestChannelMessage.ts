import { useQuery } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";

export type LatestChannelMessage = {
  content: string;
  createdAt: number;
  pubkey: string;
};

const SCAN_LIMIT = 20;

/** The newest written message in a channel (shared records have no text). */
export function useLatestChannelMessage(channelId: string | null) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery<LatestChannelMessage | null>({
    enabled: Boolean(channelId && relayUrl),
    queryKey: ["client-latest-message", relayUrl, channelId?.toLowerCase()],
    queryFn: async () => {
      if (!channelId) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
        "#h": [channelId.toLowerCase()],
        limit: SCAN_LIMIT,
      });
      const newest = events
        .filter((event) => event.content.trim().length > 0)
        .sort((left, right) => right.created_at - left.created_at)[0];
      return newest
        ? {
            content: newest.content.trim(),
            createdAt: newest.created_at,
            pubkey: newest.pubkey.toLowerCase(),
          }
        : null;
    },
    staleTime: 30_000,
    retry: false,
  });
}
