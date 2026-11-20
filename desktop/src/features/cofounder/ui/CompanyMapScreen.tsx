import { useEffect, useMemo, useState } from "react";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useChannelsQuery } from "@/features/channels/hooks";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMapShellEnabled } from "@/features/map-shell/useMapShellEnabled";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useProfileQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  useCofounderSettingsQuery,
  useFunctionSlotsQuery,
  useWorkerRunsQuery,
} from "../hooks";
import { workerEffectiveStatus } from "../cofounderRecords";
import { FUNCTION_ORDER } from "../functions";
import { useNeedsYouSummary } from "../needsYouSummary";
import { useWhatsAppStatusQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { operationsMapWorkflows } from "../companyMapOperations";
import { usePlaybooksQuery } from "../playbookHooks";
import {
  companyMapScoutChannelId,
  companyMapScoutPubkey,
} from "../companyMapScout";
import {
  readPrebuiltHireCompletion,
  type PrebuiltHireCompletion,
} from "../prebuiltHireStorage";

import { CompanyMapBoard } from "./companyMap/CompanyMapBoard";
import { PrebuiltHeadHireDialog } from "./PrebuiltHeadHireDialog";
import type { CompanyMapWindowJob } from "../companyMapJobRoutes";

export function CompanyMapScreen({
  mapWindowJob = null,
  mapWindowDepth = 0,
  onMapWindowClose,
  onMapWindowFit,
}: {
  mapWindowJob?: CompanyMapWindowJob | null;
  mapWindowDepth?: number;
  onMapWindowClose?: () => void;
  onMapWindowFit?: () => void;
} = {}) {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const profileQuery = useProfileQuery(Boolean(activeCommunity));
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const needsYouSummary = useNeedsYouSummary();
  const workerRunsQuery = useWorkerRunsQuery(null, { all: true });
  const mapShellEnabled = useMapShellEnabled();
  const enabled = settingsQuery.data?.settings.enabled ?? mapShellEnabled;
  const whatsappStatus = useWhatsAppStatusQuery(enabled);
  const playbooksQuery = usePlaybooksQuery(Boolean(activeCommunity));
  const channelsQuery = useChannelsQuery({ enabled: Boolean(activeCommunity) });
  const members = teamQuery.data?.members ?? [];
  const pubkeys = members.map((member) => member.pubkey);
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const scoutPubkey = useMemo(
    () => companyMapScoutPubkey(members, profiles),
    [members, profiles],
  );
  const companyName = activeCommunity?.name ?? "Company";
  const [hireFunctionId, setHireFunctionId] = useState<
    (typeof FUNCTION_ORDER)[number] | null
  >(null);
  const [recentPrebuiltHires, setRecentPrebuiltHires] = useState<
    Partial<Record<(typeof FUNCTION_ORDER)[number], PrebuiltHireCompletion>>
  >({});
  useEffect(() => {
    const restored: Partial<
      Record<(typeof FUNCTION_ORDER)[number], PrebuiltHireCompletion>
    > = {};
    for (const functionId of FUNCTION_ORDER) {
      const completion = readPrebuiltHireCompletion(
        activeCommunity?.id,
        functionId,
      );
      if (completion) restored[functionId] = completion;
    }
    setRecentPrebuiltHires(restored);
  }, [activeCommunity?.id]);
  const operationsWorkflows = useMemo(
    () =>
      operationsMapWorkflows({
        jobs: playbooksQuery.data?.jobs ?? [],
        playbooks: playbooksQuery.data?.playbooks ?? [],
      }),
    [playbooksQuery.data],
  );
  const scoutChannelId = useMemo(
    () => companyMapScoutChannelId(channelsQuery.data, scoutPubkey),
    [channelsQuery.data, scoutPubkey],
  );
  const clientChannelId = useMemo(() => {
    const scopedId = activeCommunity?.clientChannelId?.toLowerCase();
    if (!scopedId) return null;
    return (
      channelsQuery.data?.find(
        (channel) =>
          channel.isMember &&
          channel.channelType === "stream" &&
          channel.visibility === "private" &&
          channel.id.toLowerCase() === scopedId,
      )?.id ?? null
    );
  }, [activeCommunity?.clientChannelId, channelsQuery.data]);
  const liveFunctionIds = useMemo(() => {
    const runningParentPubkeys = new Set(
      (workerRunsQuery.data ?? [])
        .filter((run) => workerEffectiveStatus(run) === "running")
        .map((run) => run.parentPubkey.toLowerCase()),
    );
    return FUNCTION_ORDER.filter((functionId) => {
      const slot = slots.find(
        (candidate) => candidate.functionId === functionId,
      );
      const runnerPubkey =
        slot?.state === "filled"
          ? slot.leadPubkey
          : slot?.state === "covered_by_scout"
            ? scoutPubkey
            : null;
      return (
        runnerPubkey !== null &&
        runningParentPubkeys.has(runnerPubkey.toLowerCase())
      );
    });
  }, [scoutPubkey, slots, workerRunsQuery.data]);

  if ((settingsQuery.isLoading && !mapShellEnabled) || teamQuery.isLoading) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading the company map
        </p>
      </TeamPage>
    );
  }
  if ((settingsQuery.isError && !mapShellEnabled) || teamQuery.isError) {
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
  const ownerName = profileQuery.data?.displayName?.trim() || "Owner";
  const canHirePrebuiltHeads = membershipQuery.data?.role === "owner";

  return (
    <>
      {!enabled ? (
        <p
          className="mx-auto mt-3 max-w-2xl rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          data-testid="cofounder-map-mode-off-notice"
        >
          Co-founder mode is off. You can still choose a head here, then turn it
          on in Settings when you are ready for the company to work with them.
        </p>
      ) : null}
      <CompanyMapBoard
        companyId={activeCommunity?.id}
        companyName={companyName}
        members={members}
        ownerAvatarUrl={profileQuery.data?.avatarUrl}
        ownerName={ownerName}
        ownerPubkey={identityQuery.data?.pubkey}
        profiles={profiles}
        relayUrl={activeCommunity?.relayUrl}
        scoutPubkey={scoutPubkey}
        canHirePrebuiltHeads={canHirePrebuiltHeads}
        onHireHead={setHireFunctionId}
        recentPrebuiltHires={recentPrebuiltHires}
        slots={slots}
        liveFunctionIds={liveFunctionIds}
        mapWindowDepth={mapWindowDepth}
        mapWindowJob={mapWindowJob}
        onMapWindowClose={onMapWindowClose}
        onMapWindowFit={onMapWindowFit}
        clientChannelId={clientChannelId}
        operationsWorkflows={operationsWorkflows}
        scoutChannelId={scoutChannelId}
        summary={needsYouSummary.data}
        whatsAppChannelId={whatsappStatus.data?.outreachChannelId}
      />
      <PrebuiltHeadHireDialog
        defaultChannelId={scoutChannelId}
        functionId={hireFunctionId}
        managerPubkey={scoutPubkey}
        onCompleted={(completion) => {
          if (completion) {
            setRecentPrebuiltHires((current) => ({
              ...current,
              [completion.functionId]: completion,
            }));
          }
          setHireFunctionId(null);
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setHireFunctionId(null);
        }}
        open={hireFunctionId !== null}
        ownerName={ownerName}
      />
    </>
  );
}
