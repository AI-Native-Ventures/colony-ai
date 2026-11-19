import * as React from "react";
import { Link } from "@tanstack/react-router";

import {
  companyMapScoutChannelId,
  companyMapScoutPubkey,
} from "@/features/cofounder/companyMapScout";
import type { CompanyMapNoScreenWindowJob } from "@/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { JobAssignmentSpot } from "@/features/cofounder/ui/JobAssignmentSpot";

/** Renders an honest in-map destination for a job whose app screen is absent. */
export function MapCanvasNoScreenCard({
  job,
}: {
  job: CompanyMapNoScreenWindowJob;
}) {
  const { activeCommunity } = useCommunities();
  const cardRef = React.useRef<HTMLElement>(null);
  const capId = React.useId();
  const headingId = React.useId();
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const channelsQuery = useChannelsQuery({ enabled: Boolean(activeCommunity) });
  const members = teamQuery.data?.members ?? [];
  const pubkeys = members.map((member) => member.pubkey);
  const profilesQuery = useUsersBatchQuery(pubkeys, {
    enabled: pubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
  const scoutPubkey = React.useMemo(
    () => companyMapScoutPubkey(members, profiles),
    [members, profiles],
  );
  const scoutChannelId = React.useMemo(
    () => companyMapScoutChannelId(channelsQuery.data, scoutPubkey),
    [channelsQuery.data, scoutPubkey],
  );
  const partName = FUNCTION_DETAILS[job.functionId].name;

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      aria-labelledby={`${capId} ${headingId}`}
      className="map-canvas-no-screen-card"
      data-job={`${job.functionId}:${job.jobName}`}
      data-testid="fullmap-no-screen-card"
      ref={cardRef}
      tabIndex={-1}
    >
      <p
        className="map-canvas-no-screen-card-cap"
        data-testid="fullmap-no-screen-cap"
        id={capId}
      >
        {partName}, {job.jobName}
      </p>
      <h1 className="map-canvas-no-screen-card-title" id={headingId}>
        No screen yet
      </h1>
      <p className="map-canvas-no-screen-card-copy">
        {job.jobName} has no screen in the app yet.
      </p>
      <JobAssignmentSpot
        functionId={job.functionId}
        jobName={job.jobName}
        presentation="inline"
      />
      {scoutChannelId ? (
        <Link
          className="map-canvas-no-screen-card-action"
          params={{ channelId: scoutChannelId }}
          to="/channels/$channelId"
        >
          Ask Scout
        </Link>
      ) : null}
    </section>
  );
}
