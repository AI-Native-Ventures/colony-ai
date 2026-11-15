import type { TeamMember } from "@/features/company-team/teamModels";
import type { Channel } from "@/shared/api/types";

type CompanyMapProfiles = Readonly<
  Record<string, { displayName: string | null }>
>;

/** Finds the managed Scout member using the same display-name rule as the map. */
export function companyMapScoutPubkey(
  members: readonly TeamMember[],
  profiles: CompanyMapProfiles,
): string | null {
  const scout = members.find((member) => {
    const name =
      profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
      member.managedAgent?.name?.trim() ||
      member.fallbackName?.trim();
    return name?.toLowerCase() === "scout";
  });
  return scout?.pubkey ?? null;
}

/** Selects the owner's preferred stream conversation with Scout. */
export function companyMapScoutChannelId(
  channels: readonly Channel[] | undefined,
  scoutPubkey: string | null,
): string | null {
  if (!scoutPubkey) return null;
  const normalizedScoutPubkey = scoutPubkey.toLowerCase();
  return (
    channels
      ?.filter(
        (channel) =>
          channel.isMember &&
          channel.channelType === "stream" &&
          channel.memberPubkeys.some(
            (pubkey) => pubkey.toLowerCase() === normalizedScoutPubkey,
          ),
      )
      .sort((first, second) => {
        const firstIsGeneral = first.name.trim().toLowerCase() === "general";
        const secondIsGeneral = second.name.trim().toLowerCase() === "general";
        return Number(secondIsGeneral) - Number(firstIsGeneral);
      })[0]?.id ?? null
  );
}
