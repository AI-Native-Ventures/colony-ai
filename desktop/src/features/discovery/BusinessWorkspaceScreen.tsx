import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { DiscoveryScreen } from "./DiscoveryScreen";
import { CampaignScreen } from "./CampaignScreen";
import { W10Error, W10Loading } from "./BusinessCommon";
import { LeadDetailScreen, LeadsScreen, PipelineScreen } from "./LeadScreens";
import {
  ProposalDetailScreen,
  ProposalsScreen,
  ServiceScreen,
} from "./ProposalScreens";
import { useBusinessRecords } from "./useBusinessRecords";
import { getDiscoveryCampaignProvider } from "./discoveryProvider";

import "./business-records.css";

export function BusinessWorkspaceScreen() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const discoveryProvider = getDiscoveryCampaignProvider();

  React.useEffect(() => {
    if (pathname === "/campaign" && !discoveryProvider) {
      void navigate({ to: "/discovery", replace: true });
    }
  }, [discoveryProvider, navigate, pathname]);

  if (pathname === "/discovery") return <DiscoveryScreen />;
  if (pathname === "/campaign" && !discoveryProvider) return null;
  return <BusinessRecordsRoute pathname={pathname} />;
}

function BusinessRecordsRoute({ pathname }: { pathname: string }) {
  const business = useBusinessRecords();

  if (
    business.channelLoading ||
    (business.channelId && business.recordsLoading)
  ) {
    return <W10Loading />;
  }
  if (business.channelError || business.recordsError) {
    return (
      <W10Error
        message="Business records could not be loaded. Retry when the connection is available."
        onRetry={() => void business.refresh()}
        retrying={business.channelLoading || business.recordsLoading}
      />
    );
  }
  if (!business.channelId || !business.communityId || !business.records) {
    return (
      <W10Error
        message="A private Sales stream is not available for business records."
        onRetry={() => void business.refresh()}
        retrying={business.channelLoading}
        title="Business records unavailable"
      />
    );
  }

  const context = {
    channelId: business.channelId,
    communityId: business.communityId,
    currentPubkey: business.pubkey,
    records: business.records,
    refresh: business.refresh,
    role: business.role,
  };
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (pathname === "/leads") return <LeadsScreen {...context} />;
  if (pathname === "/campaign") return <CampaignScreen {...context} />;
  if (pathname === "/pipeline") return <PipelineScreen {...context} />;
  if (pathname === "/sales/proposals") return <ProposalsScreen {...context} />;
  if (pathname === "/sales/service") return <ServiceScreen {...context} />;
  if (parts[0] === "sales" && parts[1] === "lead") {
    const prospectId = parts[2] ?? "";
    const prospect =
      prospectId === "form-field"
        ? business.records.prospects.find(
            (candidate) =>
              candidate.record.prospect.party.displayName === "Form & Field",
          )
        : business.records.prospects.find(
            (candidate) => candidate.record.prospectId === prospectId,
          );
    return <LeadDetailScreen {...context} prospect={prospect ?? null} />;
  }
  if (parts[0] === "sales" && parts[1] === "proposal") {
    const proposalId = parts[2] ?? "";
    const prospectForAlias = business.records.prospects.find(
      (candidate) =>
        candidate.record.prospect.party.displayName === "Form & Field",
    );
    const matchedProposal =
      proposalId === "proposal-form" && prospectForAlias
        ? business.records.proposals.find(
            (candidate) =>
              candidate.version?.prospectPartyId ===
              prospectForAlias.record.prospect.party.partyId,
          )
        : business.records.proposals.find(
            (candidate) => candidate.head.proposalId === proposalId,
          );
    return (
      <ProposalDetailScreen {...context} proposal={matchedProposal ?? null} />
    );
  }

  return (
    <W10Error
      message="Return to the business routes and choose a record."
      onRetry={() => void business.refresh()}
      title="Record unavailable"
    />
  );
}
