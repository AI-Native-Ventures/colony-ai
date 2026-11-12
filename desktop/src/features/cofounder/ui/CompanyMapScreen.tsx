import { Link } from "@tanstack/react-router";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useProfileQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { useCofounderSettingsQuery, useFunctionSlotsQuery } from "../hooks";
import { useWhatsAppStatusQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";

import { CompanyMapBoard } from "./companyMap/CompanyMapBoard";

export function CompanyMapScreen() {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const profileQuery = useProfileQuery(Boolean(activeCommunity));
  const identityQuery = useIdentityQuery();
  const enabled = settingsQuery.data?.settings.enabled === true;
  const whatsappStatus = useWhatsAppStatusQuery(enabled);
  const members = teamQuery.data?.members ?? [];
  const pubkeys = members.map((member) => member.pubkey);
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const scout = members.find((member) => {
    const name =
      profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
      member.managedAgent?.name?.trim() ||
      member.fallbackName?.trim();
    return name?.toLowerCase() === "scout";
  });
  const companyName = activeCommunity?.name ?? "Company";

  if (settingsQuery.isLoading || teamQuery.isLoading) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading the company map
        </p>
      </TeamPage>
    );
  }
  if (settingsQuery.isError || teamQuery.isError) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <div role="alert" className="space-y-3">
          <TeamPageTitle>Company map</TeamPageTitle>
          <p className="text-sm text-destructive">
            The company map could not load.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => {
              void settingsQuery.refetch();
              void teamQuery.refetch();
            }}
            type="button"
          >
            Try again
          </button>
        </div>
      </TeamPage>
    );
  }
  if (!settingsQuery.data?.settings.enabled) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <div className="space-y-3">
          <TeamPageTitle>Company map</TeamPageTitle>
          <p className="text-sm text-muted-foreground">
            Co-founder mode is off for {companyName}.
          </p>
          <Link
            className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted"
            to="/settings"
          >
            Open settings
          </Link>
        </div>
      </TeamPage>
    );
  }

  return (
    <CompanyMapBoard
      companyId={activeCommunity?.id}
      companyName={companyName}
      members={members}
      ownerAvatarUrl={profileQuery.data?.avatarUrl}
      ownerName={profileQuery.data?.displayName?.trim() || "Owner"}
      ownerPubkey={identityQuery.data?.pubkey}
      profiles={profiles}
      relayUrl={activeCommunity?.relayUrl}
      scoutPubkey={scout?.pubkey}
      slots={slots}
      summary={undefined}
      whatsAppChannelId={whatsappStatus.data?.outreachChannelId}
    />
  );
}
