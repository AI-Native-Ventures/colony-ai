import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_BUSINESS_PROFILE_ACTION,
  KIND_BUSINESS_PROFILE_HEAD,
} from "@/shared/constants/kinds";
import type { OnboardingBusinessProfile } from "@/features/onboarding/ui/BusinessSetupStep";

import {
  BUSINESS_PROFILE_D_TAG,
  onboardingFieldsMatch,
  onboardingToCompanyBusinessProfile,
  parseCompanyBusinessProfileHead,
  type CompanyBusinessProfile,
  type CompanyBusinessProfileHead,
} from "./businessProfileModels";

export const businessProfileQueryKey = (relayUrl: string | null) =>
  ["company-business-profile", relayUrl] as const;

export async function fetchCompanyBusinessProfile(): Promise<CompanyBusinessProfileHead | null> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf)
    throw new Error("This relay does not advertise a signing identity.");
  const events = await relayClient.fetchEvents({
    kinds: [KIND_BUSINESS_PROFILE_HEAD],
    authors: [relaySelf],
    "#d": [BUSINESS_PROFILE_D_TAG],
    limit: 10,
  });
  if (events.length >= 10) {
    throw new Error("The business profile read exceeded its safe limit.");
  }
  const heads = events.map((event) => {
    const head = parseCompanyBusinessProfileHead(event, relaySelf);
    if (!head)
      throw new Error("The relay returned an invalid signed business profile.");
    return head;
  });
  return heads.sort((a, b) => b.revision - a.revision)[0] ?? null;
}

export async function publishCompanyBusinessProfile(
  profile: CompanyBusinessProfile,
  expectedRevision: number | null,
) {
  const event = await signRelayEvent({
    kind: KIND_BUSINESS_PROFILE_ACTION,
    content: JSON.stringify({ profile, expectedRevision }),
    tags: [["d", BUSINESS_PROFILE_D_TAG]],
  });
  await relayClient.publishEvent(
    event,
    "Timed out saving the business profile.",
    "Failed to save the business profile.",
  );
  return event;
}

/** Complete a first-run profile only after the company relay confirms its head. */
export async function ensureSharedBusinessProfile(
  local: OnboardingBusinessProfile,
  isCurrent: () => boolean,
) {
  const expected = onboardingToCompanyBusinessProfile(local);
  const current = await fetchCompanyBusinessProfile();
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  if (current) {
    if (onboardingFieldsMatch(current.profile, expected)) return current;
    throw new Error(
      "The business profile changed on another computer. Open Business profile in Settings to review it.",
    );
  }
  try {
    await publishCompanyBusinessProfile(expected, null);
  } catch (cause) {
    // A transport timeout can follow a committed write. Read before retrying.
    const recovered = await fetchCompanyBusinessProfile().catch(() => null);
    if (recovered && onboardingFieldsMatch(recovered.profile, expected))
      return recovered;
    throw cause;
  }
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  const saved = await fetchCompanyBusinessProfile();
  if (saved && onboardingFieldsMatch(saved.profile, expected)) return saved;
  throw new Error("The business profile is still being saved. Try again.");
}

export function useCompanyBusinessProfileQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: businessProfileQueryKey(relayUrl),
    queryFn: fetchCompanyBusinessProfile,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useSaveCompanyBusinessProfile() {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      profile,
      expectedRevision,
    }: {
      profile: CompanyBusinessProfile;
      expectedRevision: number | null;
    }) => {
      await publishCompanyBusinessProfile(profile, expectedRevision);
      const saved = await fetchCompanyBusinessProfile();
      if (!saved || saved.revision !== (expectedRevision ?? 0) + 1) {
        throw new Error(
          "The business profile is still being saved. Refresh and try again.",
        );
      }
      return saved;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: businessProfileQueryKey(relayUrl),
      });
    },
  });
}
