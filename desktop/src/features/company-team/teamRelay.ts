import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { relayMembersFromEvent } from "@/shared/api/relayMembers";
import { relayClient } from "@/shared/api/relayClient";
import {
  listManagedAgents,
  listRelayAgents,
  signRelayEvent,
} from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_MEMBER_POSITION_ACTION,
  KIND_MEMBER_POSITION_HEAD,
} from "@/shared/constants/kinds";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";

import {
  MEMBER_POSITION_HEAD_QUERY_LIMIT,
  mergeTeamMembers,
  memberPositionDTag,
  parseMemberPositionActionEvent,
  parseMemberPositionHeadEvent,
  type MemberPositionAction,
  type MemberPositionActionRecord,
  type MemberPositionHeadRecord,
  type TeamMember,
} from "./teamModels";

const MEMBER_LIST_KIND = 13_534;
const MEMBER_POSITION_HISTORY_LIMIT = 500;

export type CompanyTeamData = {
  members: TeamMember[];
  relayMembers: ReturnType<typeof relayMembersFromEvent>;
  membershipSnapshotFound: boolean;
  relaySelf: string;
};

export type CompanyTeamCountData = {
  memberCount: number | null;
  membershipSnapshotFound: boolean;
};

export const companyTeamQueryKey = (relayUrl: string | null) =>
  ["company-team", relayUrl] as const;
export const companyTeamCountQueryKey = (relayUrl: string | null) =>
  ["company-team-count", relayUrl] as const;
export const memberPositionHistoryQueryKey = (
  relayUrl: string | null,
  memberPubkey: string,
) => ["company-member-position-history", relayUrl, memberPubkey] as const;

async function fetchMemberPositionHistory(
  memberPubkey: string,
): Promise<MemberPositionActionRecord[]> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_MEMBER_POSITION_ACTION],
    "#d": [memberPositionDTag(memberPubkey)],
    limit: MEMBER_POSITION_HISTORY_LIMIT,
  });
  if (events.length >= MEMBER_POSITION_HISTORY_LIMIT) {
    throw new Error("This member history exceeds the supported record limit.");
  }
  return events
    .map((event) => parseMemberPositionActionEvent(event, memberPubkey))
    .filter((record): record is MemberPositionActionRecord => record !== null)
    .sort((first, second) => second.event.created_at - first.event.created_at);
}

async function fetchCompanyTeamCount(
  relayUrl: string,
): Promise<CompanyTeamCountData> {
  const [membershipEvent, relayAgents, managedAgents] = await Promise.all([
    relayClient.fetchFirstEvent({ kinds: [MEMBER_LIST_KIND], limit: 1 }),
    listRelayAgents(),
    listManagedAgents(),
  ]);
  if (!membershipEvent) {
    return { memberCount: null, membershipSnapshotFound: false };
  }
  const relayMembers = relayMembersFromEvent(membershipEvent);
  const members = mergeTeamMembers({
    relayMembers,
    relayAgents,
    managedAgents,
    positions: [],
    relayUrl,
  });
  return { memberCount: members.length, membershipSnapshotFound: true };
}

async function fetchCompanyTeam(relayUrl: string): Promise<CompanyTeamData> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const [membershipEvent, positionEvents, relayAgents, managedAgents] =
    await Promise.all([
      relayClient.fetchFirstEvent({ kinds: [MEMBER_LIST_KIND], limit: 1 }),
      relayClient.fetchEvents({
        kinds: [KIND_MEMBER_POSITION_HEAD],
        authors: [relaySelf],
        limit: MEMBER_POSITION_HEAD_QUERY_LIMIT,
      }),
      listRelayAgents(),
      listManagedAgents(),
    ]);
  if (positionEvents.length >= MEMBER_POSITION_HEAD_QUERY_LIMIT) {
    throw new Error("The company team exceeds the supported member limit.");
  }
  const positions: MemberPositionHeadRecord[] = positionEvents.map((event) => {
    const position = parseMemberPositionHeadEvent(event, relaySelf);
    if (!position) {
      throw new Error("The relay returned an invalid signed member position.");
    }
    return position;
  });
  const relayMembers = membershipEvent
    ? relayMembersFromEvent(membershipEvent)
    : [];
  return {
    members: mergeTeamMembers({
      relayMembers,
      relayAgents,
      managedAgents,
      positions,
      relayUrl,
    }),
    relayMembers,
    membershipSnapshotFound: membershipEvent !== null,
    relaySelf,
  };
}

export function useCompanyTeamQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: companyTeamQueryKey(relayUrl),
    queryFn: () => fetchCompanyTeam(relayUrl as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompanyTeamMemberQuery(
  memberPubkey: string,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalizedPubkey = memberPubkey.toLowerCase();
  const selectMember = useCallback(
    (data: CompanyTeamData) =>
      data.members.find((member) => member.pubkey === normalizedPubkey) ?? null,
    [normalizedPubkey],
  );
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: companyTeamQueryKey(relayUrl),
    queryFn: () => fetchCompanyTeam(relayUrl as string),
    select: selectMember,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompanyTeamCountQuery() {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: relayUrl !== null,
    queryKey: companyTeamCountQueryKey(relayUrl),
    queryFn: () => fetchCompanyTeamCount(relayUrl as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useMemberPositionHistoryQuery(
  memberPubkey: string,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const normalizedPubkey = memberPubkey.toLowerCase();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: memberPositionHistoryQueryKey(relayUrl, normalizedPubkey),
    queryFn: () => fetchMemberPositionHistory(normalizedPubkey),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useMemberPositionActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (action: MemberPositionAction): Promise<RelayEvent> => {
      if (!relayUrl) throw new Error("No active community is selected.");
      const event = await signRelayEvent({
        kind: KIND_MEMBER_POSITION_ACTION,
        content: JSON.stringify(action),
        tags: [["d", memberPositionDTag(action.pubkey)]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the member position.",
        "Failed to save the member position.",
      );
      return event;
    },
    onSettled: async (_data, _error, action) => {
      if (relayUrl) {
        await queryClient.invalidateQueries({
          queryKey: companyTeamQueryKey(relayUrl),
        });
        await queryClient.invalidateQueries({
          queryKey: memberPositionHistoryQueryKey(relayUrl, action.pubkey),
        });
      }
    },
  });
}
