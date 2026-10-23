import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { KIND_MEMBER_POSITION_HEAD } from "@/shared/constants/kinds";

import {
  MEMBER_POSITION_HEAD_QUERY_LIMIT,
  normalizeTeamPubkey,
  parseMemberPositionHeadEvent,
} from "./teamModels";

const EMPTY_TITLES: ReadonlyMap<string, string> = new Map();

export const memberJobTitlesQueryKey = (relayUrl: string | null) =>
  ["member-job-titles", relayUrl] as const;

/**
 * Every member's job title, keyed by pubkey, read from the relay-signed
 * member position heads. One request per community, shared by every message
 * header; a relay that does not sign positions simply has no titles.
 *
 * This is the single place that decides what "the sender has a title" means:
 * when people's titles move onto their profile, read them here too.
 */
async function fetchMemberJobTitles(): Promise<ReadonlyMap<string, string>> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) return EMPTY_TITLES;
  const events = await relayClient.fetchEvents({
    kinds: [KIND_MEMBER_POSITION_HEAD],
    authors: [relaySelf],
    limit: MEMBER_POSITION_HEAD_QUERY_LIMIT,
  });
  const titles = new Map<string, string>();
  for (const event of events) {
    const record = parseMemberPositionHeadEvent(event, relaySelf);
    const title = record?.head.title.trim();
    if (record && title) titles.set(record.head.pubkey, title);
  }
  return titles;
}

/** The sender's job title, or null when they have none (show nothing then). */
export function useMemberJobTitle(
  pubkey: string | null | undefined,
  enabled = true,
): string | null {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalized = pubkey ? normalizeTeamPubkey(pubkey) : null;
  const select = useCallback(
    (titles: ReadonlyMap<string, string>) =>
      (normalized ? titles.get(normalized) : null) ?? null,
    [normalized],
  );
  const query = useQuery({
    enabled: enabled && relayUrl !== null && normalized !== null,
    queryKey: memberJobTitlesQueryKey(relayUrl),
    queryFn: fetchMemberJobTitles,
    select,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return query.data ?? null;
}
