import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { DiscoveryScreen } from "./DiscoveryScreen";
import { CampaignScreen } from "./CampaignScreen";
import { OutreachListScreen } from "./OutreachListScreen";
import { TENANT_COMMUNITY_UNKNOWN_MESSAGE } from "@/features/communities/tenantCommunity";
import { W10Error, W10Loading } from "./BusinessCommon";
import { LeadDetailScreen, LeadsScreen, PipelineScreen } from "./LeadScreens";
import { useBusinessRecords } from "./useBusinessRecords";
import { CampaignRelaySync } from "./CampaignRelaySync";
import { getDiscoveryCampaignProvider } from "./discoveryProvider";
import {
  SALES_NOT_ALLOWED_MESSAGE,
  SalesChannelSetupError,
} from "./salesChannel";

import "./business-records.css";

export function BusinessWorkspaceScreen() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const discoveryProvider = getDiscoveryCampaignProvider();
  const business = useBusinessRecords();

  React.useEffect(() => {
    if (pathname === "/campaign" && !discoveryProvider?.getCurrent()) {
      void navigate({ to: "/discovery", replace: true });
    }
  }, [discoveryProvider, navigate, pathname]);

  const screen =
    pathname === "/discovery" ? (
      <DiscoveryScreen />
    ) : pathname === "/campaign" && !discoveryProvider?.getCurrent() ? null : (
      <BusinessRecordsRoute business={business} pathname={pathname} />
    );
  return (
    <>
      {screen}
      <CampaignRelaySyncHost business={business} />
    </>
  );
}

function BusinessRecordsRoute({
  business,
  pathname,
}: {
  business: ReturnType<typeof useBusinessRecords>;
  pathname: string;
}) {
  if (
    business.channelLoading ||
    business.tenantLoading ||
    (business.channelId && business.recordsLoading)
  ) {
    return <W10Loading />;
  }
  if (business.tenantError) {
    // Without the relay's own business id no record can be saved or found, so
    // say so plainly instead of showing records that cannot be changed.
    return (
      <W10Error
        message={TENANT_COMMUNITY_UNKNOWN_MESSAGE}
        onRetry={() => void business.refresh()}
        retrying={business.tenantLoading}
        title="Business could not be confirmed"
      />
    );
  }
  if (business.channelError instanceof SalesChannelSetupError) {
    return (
      <W10Error
        message={business.channelError.message}
        onRetry={() => void business.refresh()}
        retrying={business.channelLoading}
        title="Sales channel could not be set up"
      />
    );
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
  if (business.needsBusinessChannel) {
    return (
      <W10Error
        message={SALES_NOT_ALLOWED_MESSAGE}
        onRetry={() => void business.refresh()}
        retrying={business.channelLoading}
        title="Sales channel not set up"
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

  let screen: React.ReactNode;
  if (pathname === "/leads") screen = <LeadsScreen {...context} />;
  else if (pathname === "/lists") {
    screen = <OutreachListScreen context={context} />;
  } else if (parts[0] === "lists") {
    screen = <OutreachListScreen context={context} listId={parts[1]} />;
  } else if (pathname === "/campaign") {
    screen = <CampaignScreen {...context} />;
  } else if (pathname === "/pipeline") {
    screen = <PipelineScreen {...context} />;
  } else if (parts[0] === "sales" && parts[1] === "lead") {
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
    screen = <LeadDetailScreen {...context} prospect={prospect ?? null} />;
  } else {
    screen = (
      <W10Error
        message="Return to the business routes and choose a record."
        onRetry={() => void business.refresh()}
        title="Record unavailable"
      />
    );
  }
  return screen;
}

function CampaignRelaySyncHost({
  business,
}: {
  business: ReturnType<typeof useBusinessRecords>;
}) {
  if (
    business.channelLoading ||
    business.tenantLoading ||
    business.recordsLoading ||
    business.channelError ||
    business.tenantError ||
    business.recordsError ||
    !business.channelId ||
    !business.communityId ||
    !business.records
  ) {
    return null;
  }
  return (
    <CampaignRelaySync
      context={{
        channelId: business.channelId,
        communityId: business.communityId,
        currentPubkey: business.pubkey,
        records: business.records,
        refresh: business.refresh,
        role: business.role,
      }}
    />
  );
}
