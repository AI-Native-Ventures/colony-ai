/** Resolve one person or agent picture for every avatar surface. */
export function resolveAvatarUrl(
  profileUrl: string | null | undefined,
  managedAgentUrl: string | null | undefined,
  fallbackUrl?: string | null,
): string | null {
  return (
    profileUrl?.trim() || managedAgentUrl?.trim() || fallbackUrl?.trim() || null
  );
}
