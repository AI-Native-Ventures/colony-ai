import * as React from "react";

import type { TeamMember } from "@/features/company-team/teamModels";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";

/**
 * Job title per agent definition (persona id), read from the team's position
 * records of the agents already running from that definition. A definition no
 * agent runs from has no entry, which the Add agents list shows as
 * "Template · not yet running".
 */
export function personaJobTitlesFromTeam(
  members: readonly TeamMember[],
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const member of members) {
    const personaId = member.managedAgent?.personaId;
    const title = member.position?.head.title?.trim();
    if (personaId && title && !titles.has(personaId)) {
      titles.set(personaId, title);
    }
  }
  return titles;
}

export function usePersonaJobTitles(enabled: boolean): Map<string, string> {
  const teamQuery = useCompanyTeamQuery(enabled);
  const members = teamQuery.data?.members;
  return React.useMemo(
    () => personaJobTitlesFromTeam(members ?? []),
    [members],
  );
}
