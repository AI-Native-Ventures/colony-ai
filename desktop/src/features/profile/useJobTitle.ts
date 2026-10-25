import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveJobTitle } from "@/features/profile/lib/jobTitle";

/**
 * The job title a person published on their profile, read from the same
 * batched profile lookup that supplies names and avatars. Pass `positionTitle`
 * (an employee's company title) and `isOwner` to get the full fallback chain
 * of {@link resolveJobTitle}.
 */
export function useJobTitle(
  pubkey: string | null | undefined,
  fallback: { positionTitle?: string | null; isOwner?: boolean } = {},
): string {
  const normalized = pubkey?.toLowerCase() ?? null;
  const profiles = useUsersBatchQuery(normalized ? [normalized] : [], {
    enabled: normalized !== null,
  });
  return resolveJobTitle({
    profile: normalized ? profiles.data?.profiles[normalized] : null,
    positionTitle: fallback.positionTitle,
    isOwner: fallback.isOwner,
  });
}
