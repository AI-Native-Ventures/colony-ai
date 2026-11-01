import { loadCommunities, normalizeRelayUrl } from "./communityStorage";

const PROFILE_STORAGE_KEY = "colony-business-profile.v1";

export type OnboardingBusinessProfile = {
  name: string;
  website: string;
  description: string;
  logoDataUrl: string | null;
  logoUrl: string | null;
};

export function onboardingBusinessProfileKey(communityId: string) {
  return `${PROFILE_STORAGE_KEY}:${communityId}`;
}

export function onboardingBusinessProfileDraftKey(slug: string) {
  return `${PROFILE_STORAGE_KEY}:draft:${slug}`;
}

export function readOnboardingBusinessProfile(
  communityId: string,
): OnboardingBusinessProfile | null {
  try {
    const raw = localStorage.getItem(onboardingBusinessProfileKey(communityId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const profile = parsed as Partial<OnboardingBusinessProfile>;
    if (
      typeof profile.name !== "string" ||
      typeof profile.website !== "string" ||
      typeof profile.description !== "string" ||
      (profile.logoDataUrl !== null &&
        typeof profile.logoDataUrl !== "string") ||
      (profile.logoUrl != null && typeof profile.logoUrl !== "string")
    ) {
      return null;
    }
    return {
      name: profile.name,
      website: profile.website,
      description: profile.description,
      logoDataUrl: profile.logoDataUrl,
      logoUrl: profile.logoUrl ?? null,
    };
  } catch {
    return null;
  }
}

/** Business-profile logo for a saved community or a matching invite relay. */
export function readBusinessLogoForWorkspace(input: {
  communityId?: string;
  relayUrl?: string;
}): string | null {
  if (input.communityId) {
    return readOnboardingBusinessProfile(input.communityId)?.logoUrl ?? null;
  }
  if (!input.relayUrl) return null;
  let targetRelayUrl: string;
  try {
    targetRelayUrl = normalizeRelayUrl(input.relayUrl);
  } catch {
    return null;
  }
  const community = loadCommunities().find((candidate) => {
    try {
      return normalizeRelayUrl(candidate.relayUrl) === targetRelayUrl;
    } catch {
      return false;
    }
  });
  return community
    ? (readOnboardingBusinessProfile(community.id)?.logoUrl ?? null)
    : null;
}
