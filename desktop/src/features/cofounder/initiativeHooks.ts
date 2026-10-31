import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

import {
  BRIEF_D_TAG,
  KIND_BRIEF_ACTION,
  KIND_BRIEF_HEAD,
  KIND_ONBOARDING_ACTION,
  KIND_ONBOARDING_HEAD,
  ONBOARDING_D_TAG,
  buildBriefActionEvent,
  buildOnboardingActionEvent,
  parseBriefHead,
  parseOnboardingHead,
} from "./initiativeRecords";
import type {
  BriefActionInput,
  BriefHead,
  OnboardingActionInput,
  OnboardingHead,
} from "./initiativeRecords";

function newestFirst(first: RelayEvent, second: RelayEvent): number {
  return (
    second.created_at - first.created_at || first.id.localeCompare(second.id)
  );
}

function requireRelaySelf(relaySelf: string | null): string {
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  return relaySelf;
}

export const briefQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-brief", communityId, relayUrl] as const;

export const onboardingQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-onboarding", communityId, relayUrl] as const;

export async function fetchBrief(): Promise<{ head: BriefHead | null }> {
  const relaySelf = requireRelaySelf(await getRelaySelf());
  const events = await relayClient.fetchEvents({
    kinds: [KIND_BRIEF_HEAD],
    authors: [relaySelf],
    "#d": [BRIEF_D_TAG],
    limit: 1,
  });
  const head = [...events]
    .sort(newestFirst)
    .map((event) => parseBriefHead(event, relaySelf))
    .find((record) => record !== null);
  return { head: head ?? null };
}

export function useBriefQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: briefQueryKey(communityId, relayUrl),
    queryFn: fetchBrief,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export async function fetchOnboarding(): Promise<{
  head: OnboardingHead | null;
}> {
  const relaySelf = requireRelaySelf(await getRelaySelf());
  const events = await relayClient.fetchEvents({
    kinds: [KIND_ONBOARDING_HEAD],
    authors: [relaySelf],
    "#d": [ONBOARDING_D_TAG],
    limit: 1,
  });
  const head = [...events]
    .sort(newestFirst)
    .map((event) => parseOnboardingHead(event, relaySelf))
    .find((record) => record !== null);
  return { head: head ?? null };
}

export function useOnboardingQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: onboardingQueryKey(communityId, relayUrl),
    queryFn: fetchOnboarding,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function usePublishBriefAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: BriefActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildBriefActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_BRIEF_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the business brief.",
        "Failed to save the business brief.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: briefQueryKey(communityId, relayUrl),
      });
    },
  });
}

export function usePublishOnboardingAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: OnboardingActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildOnboardingActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_ONBOARDING_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving onboarding.",
        "Failed to save onboarding.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: onboardingQueryKey(communityId, relayUrl),
      });
    },
  });
}
