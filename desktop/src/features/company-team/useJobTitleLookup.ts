import * as React from "react";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";

const NO_TITLE_LOOKUP = () => null;

/**
 * Looks up a person's or agent's job title from the company team's signed
 * position records. Returns `null` for anyone without a position, so callers
 * can show nothing when a title is absent. The team list is one cached query
 * shared by every caller.
 */
export function useJobTitleLookup(
  enabled = true,
): (pubkey: string | null | undefined) => string | null {
  const teamQuery = useCompanyTeamQuery(enabled);
  const members = teamQuery.data?.members;
  return React.useMemo(() => {
    if (!members) return NO_TITLE_LOOKUP;
    const titles = new Map<string, string>();
    for (const member of members) {
      const title = member.position?.head.title.trim();
      if (title) titles.set(member.pubkey.toLowerCase(), title);
    }
    return (pubkey: string | null | undefined) =>
      pubkey ? (titles.get(pubkey.toLowerCase()) ?? null) : null;
  }, [members]);
}
