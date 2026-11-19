import type * as React from "react";

import type { DiscoveryCampaign } from "./discoveryProvider";
import {
  groupCampaignStatus,
  groupCityStatus,
  groupProgress,
  shortPlaceName,
  type MultiCityCampaignGroup,
  type MultiCityGroupCity,
} from "./multiCityDiscovery";

/** Supplies the tab panel semantics only while a multi-city group is open. */
export function MultiCityContentPanel({
  children,
  labelledBy,
}: {
  children: React.ReactNode;
  labelledBy: string | null;
}) {
  if (!labelledBy) return <>{children}</>;
  return (
    <div
      aria-labelledby={labelledBy}
      id="multi-city-campaign-panel"
      role="tabpanel"
    >
      {children}
    </div>
  );
}

/** Summarizes the group and leaves every failed-city retry discoverable. */
export function MultiCityAllSummary({
  campaigns,
  group,
  onRetry,
}: {
  campaigns: readonly DiscoveryCampaign[];
  group: MultiCityCampaignGroup;
  onRetry: (() => void) | null;
}) {
  const progress = groupProgress(group, campaigns);
  const status = groupCampaignStatus(group, campaigns);
  const percent = Math.min(
    100,
    progress.target ? (progress.count / progress.target) * 100 : 0,
  );
  const failedCities = group.cities.filter(
    (city) => groupCityStatus(city, campaigns) === "failed",
  ).length;
  const title = group.blockedReason
    ? "The remaining cities need attention"
    : progress.searching
      ? `${progress.searching} of ${group.cities.length} cities searching`
      : status === "complete"
        ? "All city searches are complete"
        : status === "failed"
          ? "Some city searches need attention"
          : "The city queue is paused";
  return (
    <section className="c3mc-all-summary" data-testid="multi-city-all-summary">
      <div>
        <h2>{title}</h2>
        <p>
          {progress.count} of {progress.target} prospects found in all
        </p>
      </div>
      <div
        aria-label="Multi-city prospects found"
        aria-valuemax={progress.target}
        aria-valuemin={0}
        aria-valuenow={Math.min(progress.count, progress.target)}
        className="c3mc-progress"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      {group.blockedReason ? (
        <div>
          <p>{group.blockedReason}</p>
          {onRetry && failedCities === 0 ? (
            <button
              className="c3d-btn c3d-btn--outline c3d-btn--sm"
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {failedCities > 0 ? (
        <div>
          <p>
            {failedCities} {failedCities === 1 ? "city" : "cities"} could not
            start.
          </p>
          {onRetry ? (
            <button
              aria-label="Try again all failed cities"
              className="c3d-btn c3d-btn--outline c3d-btn--sm"
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Explains why a city is queued, including a passing-error retry wait. */
export function MultiCityWaitingCity({
  city,
  group,
}: {
  city: MultiCityGroupCity;
  group: MultiCityCampaignGroup;
}) {
  const starting = city.state === "starting";
  const retrying = starting && Boolean(city.reason);
  return (
    <section
      className="c3mc-waiting-city"
      data-testid={retrying ? "multi-city-retry-waiting" : "multi-city-waiting"}
    >
      <div>
        <h2>
          {shortPlaceName(city.label)} is {starting ? "starting" : "waiting"}
        </h2>
        <p>
          {retrying
            ? city.reason
            : group.blockedReason
              ? "This city has not started yet."
              : "It starts when one of the three city slots is free."}
        </p>
      </div>
      {group.blockedReason ? <p>{group.blockedReason}</p> : null}
    </section>
  );
}

/** Names a city-start failure and keeps its direct recovery control visible. */
export function MultiCityFailedCity({
  campaign,
  city,
  onRetry,
}: {
  campaign: DiscoveryCampaign | null;
  city: MultiCityGroupCity;
  onRetry: (() => void) | null;
}) {
  const reason =
    campaign?.failureReason ??
    city.reason ??
    "Discovery could not start this city.";
  return (
    <section className="c3mc-waiting-city" data-testid="multi-city-failed-city">
      <div>
        <h2>
          {campaign
            ? `${shortPlaceName(city.label)} stopped`
            : `${shortPlaceName(city.label)} could not start`}
        </h2>
        <p>{reason}</p>
      </div>
      {onRetry ? (
        <button
          aria-label={`Try again ${shortPlaceName(city.label)}`}
          className="c3d-btn c3d-btn--outline c3d-btn--sm"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      ) : null}
    </section>
  );
}
