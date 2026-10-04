import { loadCommunities } from "@/features/communities/communityStorage";

export type ScoutBusinessContext = {
  name: string;
  website: string;
  description: string;
};

/** Read only the saved profile for the relay being provisioned, never another business's context. */
export function readScoutBusinessContext(
  relayUrl?: string | null,
): ScoutBusinessContext | null {
  if (!relayUrl) return null;
  const normalized = relayUrl.replace(/\/$/, "").toLowerCase();
  const community = loadCommunities().find(
    (entry) => entry.relayUrl.replace(/\/$/, "").toLowerCase() === normalized,
  );
  if (!community) return null;
  try {
    const raw = localStorage.getItem(
      `colony-business-profile.v1:${community.businessCommunityId ?? community.id}`,
    );
    if (!raw) return null;
    const profile: unknown = JSON.parse(raw);
    if (!profile || typeof profile !== "object") return null;
    const { name, website, description } =
      profile as Partial<ScoutBusinessContext>;
    if (
      typeof name !== "string" ||
      typeof website !== "string" ||
      typeof description !== "string"
    )
      return null;
    return { name, website, description };
  } catch {
    return null;
  }
}
