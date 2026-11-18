import * as React from "react";

import { MessageGlyph, PinGlyph } from "./DiscoveryIcons";
import type { DiscoveryCampaign } from "./discoveryProvider";
import {
  groupCampaignStatus,
  groupCityStatus,
  groupProgress,
  shortPlaceName,
  type MultiCityCampaignGroup,
} from "./multiCityDiscovery";

import "./multi-city-discovery.css";

export type MultiCityCampaignTab = "all" | string;

export function multiCityTabId(
  groupId: string,
  tab: MultiCityCampaignTab,
): string {
  return `multi-city-tab-${groupId}-${tab}`;
}

function statusLabel(status: ReturnType<typeof groupCityStatus>): string {
  if (status === "waiting") return "Waiting";
  if (status === "not_started") return "Not started";
  if (status === "running") return "Searching";
  if (status === "complete") return "Done";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  return "Paused";
}

function startedOn(createdAt: number): string {
  if (!createdAt) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(createdAt * 1000));
}

function progressPercent(found: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (found / target) * 100));
}

function CityTabProgress({ found, target }: { found: number; target: number }) {
  return (
    <span aria-hidden="true" className="c3mc-city-tab-progress">
      <span style={{ width: `${progressPercent(found, target)}%` }} />
    </span>
  );
}

/** The local group header and keyboard-operable city tabs. */
export function MultiCityCampaignTabs({
  campaigns,
  group,
  onDiscuss,
  onSelect,
  selectedTab,
}: {
  campaigns: readonly DiscoveryCampaign[];
  group: MultiCityCampaignGroup;
  onDiscuss: () => void;
  onSelect: (tab: MultiCityCampaignTab) => void;
  selectedTab: MultiCityCampaignTab;
}) {
  const tabs = ["all", ...group.cities.map((city) => city.cityId)] as const;
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const progress = groupProgress(group, campaigns);
  const totalSearching = progress.searching;
  const allStatus = groupCampaignStatus(group, campaigns);
  const allStatusLabel =
    allStatus === "complete"
      ? "Done"
      : totalSearching
        ? `${totalSearching} of ${group.cities.length} searching`
        : statusLabel(allStatus);

  function choose(tab: MultiCityCampaignTab) {
    onSelect(tab);
  }

  function moveFocus(
    event: React.KeyboardEvent<HTMLButtonElement>,
    tab: MultiCityCampaignTab,
  ) {
    const index = tabs.indexOf(tab as (typeof tabs)[number]);
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(tab);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    buttons.current.get(next)?.focus();
    choose(next);
  }

  return (
    <>
      <header className="c3mc-group-head">
        <div>
          <h1>{group.name}</h1>
          <p>
            {group.verticalName} · {group.cities.length} cities · Started{" "}
            {startedOn(group.createdAt)}
            {group.runBy?.name ? ` by ${group.runBy.name}` : ""}
          </p>
        </div>
        <button
          className="c3d-btn c3d-btn--outline c3d-btn--lg"
          onClick={onDiscuss}
          type="button"
        >
          <MessageGlyph />
          Discuss in Sales
        </button>
      </header>
      <div
        aria-label="Campaign cities"
        className="c3mc-city-tabs"
        data-map-canvas-same-desk="true"
        role="tablist"
      >
        <button
          aria-controls="multi-city-campaign-panel"
          aria-label={`All cities, ${progress.count} of ${progress.target} found, ${totalSearching} of ${group.cities.length} searching`}
          aria-selected={selectedTab === "all"}
          className="c3mc-city-tab"
          id={multiCityTabId(group.groupId, "all")}
          onClick={() => choose("all")}
          onKeyDown={(event) => moveFocus(event, "all")}
          ref={(node) => {
            if (node) buttons.current.set("all", node);
            else buttons.current.delete("all");
          }}
          role="tab"
          tabIndex={selectedTab === "all" ? 0 : -1}
          type="button"
        >
          <span className="c3mc-city-tab-top">
            <strong>All cities</strong>
            <span
              aria-hidden="true"
              className={`c3mc-city-tab-status is-${allStatus}`}
            >
              {allStatusLabel}
            </span>
          </span>
          <span className="c3mc-city-tab-count">
            <strong>{progress.count}</strong>
            <span>of {progress.target} found</span>
          </span>
          <CityTabProgress found={progress.count} target={progress.target} />
        </button>
        {group.cities.map((city) => {
          const campaign = city.campaignId
            ? campaigns.find((candidate) => candidate.id === city.campaignId)
            : null;
          const status = groupCityStatus(city, campaigns);
          const selected = selectedTab === city.cityId;
          const found = campaign?.count ?? 0;
          const label = statusLabel(status);
          return (
            <button
              aria-controls="multi-city-campaign-panel"
              aria-label={`${shortPlaceName(city.label)}, ${statusLabel(status)}, ${found} of ${group.target} found`}
              aria-selected={selected}
              className="c3mc-city-tab"
              id={multiCityTabId(group.groupId, city.cityId)}
              key={city.cityId}
              onClick={() => choose(city.cityId)}
              onKeyDown={(event) => moveFocus(event, city.cityId)}
              ref={(node) => {
                if (node) buttons.current.set(city.cityId, node);
                else buttons.current.delete(city.cityId);
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className="c3mc-city-tab-top">
                <strong>
                  <PinGlyph size={14} /> {shortPlaceName(city.label)}
                </strong>
                <span
                  aria-hidden="true"
                  className={`c3mc-city-tab-status is-${status}`}
                >
                  {label}
                </span>
              </span>
              <span className="c3mc-city-tab-count">
                <strong>{found}</strong>
                <span>of {group.target} found</span>
              </span>
              <CityTabProgress found={found} target={group.target} />
            </button>
          );
        })}
      </div>
    </>
  );
}
