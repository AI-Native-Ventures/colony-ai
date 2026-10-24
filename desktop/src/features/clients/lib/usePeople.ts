import * as React from "react";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { truncateNpub } from "@/shared/lib/pubkey";

const MAX_PEOPLE = 256;

export type PersonInfo = {
  pubkey: string;
  name: string;
  avatarUrl: string | null;
  isAgent: boolean;
  /** Job title from the team record; null when none is recorded. */
  title: string | null;
};

/**
 * Names, avatars and (optionally) job titles for the people named on a
 * business record. Unknown people fall back to a short key, never to nothing.
 */
export function usePeople(
  pubkeys: readonly string[],
  options: { titles?: boolean } = {},
): {
  people: ReadonlyMap<string, PersonInfo>;
  person: (pubkey: string) => PersonInfo;
} {
  const key = [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))]
    .filter(Boolean)
    .sort()
    .slice(0, MAX_PEOPLE)
    .join(",");
  const normalized = React.useMemo(() => (key ? key.split(",") : []), [key]);
  const profilesQuery = useUsersBatchQuery(normalized, {
    enabled: normalized.length > 0,
  });
  const teamQuery = useCompanyTeamQuery(
    options.titles === true && normalized.length > 0,
  );
  const profiles = profilesQuery.data?.profiles;
  const members = teamQuery.data?.members;

  const people = React.useMemo(() => {
    const titleByPubkey = new Map<string, string>();
    const employeeByPubkey = new Set<string>();
    for (const member of members ?? []) {
      const pubkey = member.pubkey.toLowerCase();
      const title = member.position?.head.title?.trim();
      if (title) titleByPubkey.set(pubkey, title);
      if (member.kind === "employee") employeeByPubkey.add(pubkey);
    }
    return new Map<string, PersonInfo>(
      normalized.map((pubkey) => {
        const profile = profiles?.[pubkey];
        return [
          pubkey,
          {
            pubkey,
            name: profile?.displayName?.trim() || truncateNpub(pubkey),
            avatarUrl: profile?.avatarUrl ?? null,
            isAgent: Boolean(profile?.isAgent) || employeeByPubkey.has(pubkey),
            title: titleByPubkey.get(pubkey) ?? null,
          },
        ];
      }),
    );
  }, [members, normalized, profiles]);

  const person = React.useCallback(
    (pubkey: string): PersonInfo => {
      const normalizedPubkey = pubkey.toLowerCase();
      return (
        people.get(normalizedPubkey) ?? {
          pubkey: normalizedPubkey,
          name: truncateNpub(normalizedPubkey),
          avatarUrl: null,
          isAgent: false,
          title: null,
        }
      );
    },
    [people],
  );
  return { people, person };
}
