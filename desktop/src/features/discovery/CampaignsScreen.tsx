import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import {
  CAMPAIGNS_PAGE_SIZE,
  campaignStatusLabel,
  campaignStatusFilter,
  createCampaignCatalog,
  queryCampaignCatalog,
  type CampaignCatalog,
  type CampaignCatalogFilters,
  type CampaignSizeFilter,
  type CampaignSort,
  type CampaignStatusFilter,
} from "./campaignsCatalog";
import { ChevronRightGlyph, SearchGlyph } from "./DiscoveryIcons";
import { RunnerAvatar } from "./DiscoveryRunner";
import { newProspectsCostUsd } from "./discoveryCampaignContinuation";
import { formatCustomerPrice } from "./discoveryCustomerPricing";
import {
  getDiscoveryCampaignProvider,
  useDiscoveryCampaign,
  type DiscoveryCampaign,
} from "./discoveryProvider";

import "./colony3-discovery.css";

export type CampaignsSearch = CampaignCatalogFilters & { page?: number };

type CampaignsScreenProps = {
  onSearchChange: (next: CampaignsSearch) => void;
  search: CampaignsSearch;
};

type FilterFieldProps = {
  catalog: CampaignCatalog;
  onChange: <K extends keyof CampaignsSearch>(
    key: K,
    value: CampaignsSearch[K],
  ) => void;
  search: CampaignsSearch;
};

const STATUS_OPTIONS: ReadonlyArray<{
  label: string;
  value: CampaignStatusFilter;
}> = [
  { label: "Running", value: "running" },
  { label: "Ready to review", value: "ready" },
  { label: "Stopped or ended early", value: "stopped" },
  { label: "Failed", value: "failed" },
];

const SIZE_OPTIONS: ReadonlyArray<{
  label: string;
  value: CampaignSizeFilter;
}> = [
  { label: "None", value: "none" },
  { label: "1-10 prospects", value: "1-10" },
  { label: "11-50 prospects", value: "11-50" },
  { label: "50+ prospects", value: "50-plus" },
];

const SORT_OPTIONS: ReadonlyArray<{ label: string; value: CampaignSort }> = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Most prospects", value: "prospects" },
  { label: "Name A-Z", value: "name" },
];

function formatDate(createdAt: number | undefined): string {
  if (!createdAt) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(createdAt * 1_000));
}

/** New prospects only: results already in Leads are never charged. */
function formatSpend(campaign: DiscoveryCampaign): string {
  return formatCustomerPrice(newProspectsCostUsd(campaign.count));
}

function statusTone(campaign: DiscoveryCampaign): string {
  switch (campaignStatusFilter(campaign)) {
    case "running":
      return "c3d-campaigns-status--running";
    case "ready":
      return "c3d-campaigns-status--ready";
    case "failed":
      return "c3d-campaigns-status--failed";
    case "stopped":
      return "c3d-campaigns-status--stopped";
  }
}

function activeFilterCount(search: CampaignsSearch): number {
  return [
    search.q,
    search.status,
    search.industry,
    search.type,
    search.location,
    search.runner,
    search.from,
    search.to,
    search.size,
  ].filter(Boolean).length;
}

function campaignCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "campaign" : "campaigns"}`;
}

function FilterFields({ catalog, onChange, search }: FilterFieldProps) {
  return (
    <div className="c3d-campaigns-filter-fields">
      <label className="c3d-campaigns-filter-field">
        <span>Status</span>
        <select
          aria-label="Campaign status"
          onChange={(event) =>
            onChange(
              "status",
              (event.currentTarget.value || undefined) as
                | CampaignStatusFilter
                | undefined,
            )
          }
          value={search.status ?? ""}
        >
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>Industry</span>
        <select
          aria-label="Campaign industry"
          onChange={(event) =>
            onChange("industry", event.currentTarget.value || undefined)
          }
          value={search.industry ?? ""}
        >
          <option value="">Any industry</option>
          {catalog.industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>Business type</span>
        <select
          aria-label="Campaign business type"
          onChange={(event) =>
            onChange("type", event.currentTarget.value || undefined)
          }
          value={search.type ?? ""}
        >
          <option value="">Any type</option>
          {catalog.types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>Location</span>
        <select
          aria-label="Campaign location"
          onChange={(event) =>
            onChange("location", event.currentTarget.value || undefined)
          }
          value={search.location ?? ""}
        >
          <option value="">Any location</option>
          {catalog.locations.map((location) => (
            <option key={location} value={location}>
              {location}
            </option>
          ))}
        </select>
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>Run by</span>
        <select
          aria-label="Campaign runner"
          onChange={(event) =>
            onChange("runner", event.currentTarget.value || undefined)
          }
          value={search.runner ?? ""}
        >
          <option value="">Anyone</option>
          {catalog.runners.map((runner) => (
            <option key={runner} value={runner}>
              {runner}
            </option>
          ))}
        </select>
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>From</span>
        <input
          aria-label="Campaign start date"
          onChange={(event) =>
            onChange("from", event.currentTarget.value || undefined)
          }
          type="date"
          value={search.from ?? ""}
        />
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>To</span>
        <input
          aria-label="Campaign end date"
          onChange={(event) =>
            onChange("to", event.currentTarget.value || undefined)
          }
          type="date"
          value={search.to ?? ""}
        />
      </label>
      <label className="c3d-campaigns-filter-field">
        <span>Size</span>
        <select
          aria-label="Campaign size"
          onChange={(event) =>
            onChange(
              "size",
              (event.currentTarget.value || undefined) as
                | CampaignSizeFilter
                | undefined,
            )
          }
          value={search.size ?? ""}
        >
          <option value="">Any size</option>
          {SIZE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

type ActiveFilter = {
  key: keyof CampaignsSearch;
  label: string;
};

function activeFilters(search: CampaignsSearch): ActiveFilter[] {
  const status = STATUS_OPTIONS.find(
    (option) => option.value === search.status,
  );
  const size = SIZE_OPTIONS.find((option) => option.value === search.size);
  return [
    search.q ? { key: "q", label: `Search: ${search.q}` } : null,
    status ? { key: "status", label: `Status: ${status.label}` } : null,
    search.industry
      ? { key: "industry", label: `Industry: ${search.industry}` }
      : null,
    search.type ? { key: "type", label: `Type: ${search.type}` } : null,
    search.location
      ? { key: "location", label: `Location: ${search.location}` }
      : null,
    search.runner ? { key: "runner", label: `Run by: ${search.runner}` } : null,
    search.from ? { key: "from", label: `From: ${search.from}` } : null,
    search.to ? { key: "to", label: `To: ${search.to}` } : null,
    size ? { key: "size", label: `Size: ${size.label}` } : null,
  ].filter((filter): filter is ActiveFilter => filter !== null);
}

function CampaignRow({
  campaign,
  onSelect,
}: {
  campaign: DiscoveryCampaign;
  onSelect: (campaignId: string) => void;
}) {
  const runner = campaign.runBy ?? null;
  const label = campaignStatusLabel(campaign);
  const maximum = Math.max(campaign.target, 1);
  const progress = Math.min(100, Math.round((campaign.count / maximum) * 100));

  return (
    <tr
      className="c3d-campaigns-row"
      data-testid="discovery-campaign-row"
      onClick={() => onSelect(campaign.id)}
    >
      <td
        className="c3d-campaigns-cell c3d-campaigns-campaign-name"
        data-label="Campaign"
      >
        <button
          aria-label={`Open ${campaign.name}`}
          className="c3d-campaigns-campaign-open"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(campaign.id);
          }}
          type="button"
        >
          <span className="c3d-campaigns-campaign-copy">
            <strong title={campaign.name}>{campaign.name}</strong>
            <span title={campaign.verticalName || "Business type not set"}>
              {campaign.verticalName || "Business type not set"}
            </span>
            {campaign.industryName ? (
              <small title={campaign.industryName}>
                {campaign.industryName}
              </small>
            ) : null}
          </span>
        </button>
      </td>
      <td
        className="c3d-campaigns-cell c3d-campaigns-location"
        data-label="Location"
      >
        {campaign.location || "Location not set"}
      </td>
      <td
        className="c3d-campaigns-cell c3d-campaigns-prospects"
        data-label="Prospects"
      >
        <span>
          {campaign.count.toLocaleString()} / {campaign.target.toLocaleString()}
        </span>
        <span
          aria-label={`${campaign.count} of ${campaign.target} prospects`}
          className="c3d-campaigns-progress"
          role="progressbar"
          aria-valuemax={maximum}
          aria-valuemin={0}
          aria-valuenow={campaign.count}
        >
          <span style={{ width: `${progress}%` }} />
        </span>
      </td>
      <td
        className="c3d-campaigns-cell c3d-campaigns-status-cell"
        data-label="Status"
      >
        <span
          className={`c3d-campaigns-status ${statusTone(campaign)}`}
          title={label}
        >
          {label}
        </span>
      </td>
      <td
        className="c3d-campaigns-cell c3d-campaigns-runner"
        data-label="Run by"
      >
        {runner ? (
          <span>
            <RunnerAvatar runner={runner} size={26} />
            {runner.name}
          </span>
        ) : (
          <span className="c3d-campaigns-muted">Not recorded</span>
        )}
      </td>
      <td className="c3d-campaigns-cell c3d-campaigns-date" data-label="Date">
        {formatDate(campaign.createdAt)}
      </td>
      <td className="c3d-campaigns-cell c3d-campaigns-spend" data-label="Spend">
        {formatSpend(campaign)}
      </td>
      <td aria-hidden="true" className="c3d-campaigns-open">
        <ChevronRightGlyph />
      </td>
    </tr>
  );
}

export function CampaignsScreen({
  onSearchChange,
  search,
}: CampaignsScreenProps) {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const [campaigns, setCampaigns] = React.useState<DiscoveryCampaign[]>(
    () => getDiscoveryCampaignProvider()?.getCampaigns() ?? [],
  );

  React.useEffect(() => {
    setCampaigns(provider?.getCampaigns() ?? []);
  }, [provider]);

  React.useEffect(() => {
    if (!campaign) return;
    setCampaigns((previous) => {
      const index = previous.findIndex((entry) => entry.id === campaign.id);
      if (index < 0) return [campaign, ...previous];
      if (previous[index] === campaign) return previous;
      const next = [...previous];
      next[index] = campaign;
      return next;
    });
  }, [campaign]);

  const catalog = React.useMemo(
    () => createCampaignCatalog(campaigns),
    [campaigns],
  );
  const matched = React.useMemo(
    () => queryCampaignCatalog(catalog, search),
    [catalog, search],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(matched.length / CAMPAIGNS_PAGE_SIZE),
  );
  const page = Math.min(Math.max(search.page ?? 1, 1), pageCount);
  const pageRows = matched.slice(
    (page - 1) * CAMPAIGNS_PAGE_SIZE,
    page * CAMPAIGNS_PAGE_SIZE,
  );
  const chips = activeFilters(search);
  const activeCount = activeFilterCount(search);

  function update<K extends keyof CampaignsSearch>(
    key: K,
    value: CampaignsSearch[K],
  ) {
    onSearchChange({ ...search, [key]: value, page: undefined });
  }

  function selectCampaign(campaignId: string) {
    if (!provider) return;
    void provider.select(campaignId).then(() => navigate({ to: "/campaign" }));
  }

  return (
    <main
      className="c3d-root c3d-campaigns-root"
      data-testid="discovery-campaigns-page"
    >
      <AppTopChromePortal>
        <nav aria-label="Breadcrumb" className="c3d-crumbs">
          <span>Business</span>
          <span aria-hidden="true">/</span>
          <button
            className="c3d-crumb-link"
            onClick={() => void navigate({ to: "/discovery" })}
            type="button"
          >
            Discovery
          </button>
          <span aria-hidden="true">/</span>
          <span aria-current="page" data-current="true">
            All campaigns
          </span>
        </nav>
      </AppTopChromePortal>
      <div className="c3d-page c3d-campaigns-page">
        <header className="c3d-campaigns-head">
          <div>
            <h1>All campaigns</h1>
            <p>
              {campaignCountLabel(campaigns.length)} across your Discovery work.
            </p>
          </div>
          <button
            className="c3d-btn c3d-btn--ink c3d-btn--lg"
            onClick={() => void navigate({ to: "/discovery" })}
            type="button"
          >
            New campaign <span aria-hidden="true">→</span>
          </button>
        </header>

        <section
          aria-label="Campaign filters"
          className="c3d-campaigns-toolbar"
        >
          <label className="c3d-search c3d-campaigns-search">
            <SearchGlyph size={17} />
            <input
              aria-label="Search campaigns"
              autoComplete="off"
              onChange={(event) =>
                update("q", event.currentTarget.value || undefined)
              }
              placeholder="Search campaigns, types, industries or locations…"
              type="search"
              value={search.q ?? ""}
            />
          </label>
          <label className="c3d-campaigns-sort">
            <span>Sort</span>
            <select
              aria-label="Sort campaigns"
              onChange={(event) =>
                update("sort", event.currentTarget.value as CampaignSort)
              }
              value={search.sort ?? "newest"}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="c3d-campaigns-desktop-filters">
            <FilterFields catalog={catalog} onChange={update} search={search} />
          </div>
          <details className="c3d-campaigns-mobile-filters">
            <summary>Filters{activeCount ? ` (${activeCount})` : ""}</summary>
            <FilterFields catalog={catalog} onChange={update} search={search} />
          </details>
        </section>

        {chips.length ? (
          <fieldset className="c3d-campaigns-chips">
            <legend className="sr-only">Active campaign filters</legend>
            {chips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => update(chip.key, undefined)}
                type="button"
              >
                {chip.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button
              className="c3d-campaigns-clear"
              onClick={() => onSearchChange({})}
              type="button"
            >
              Clear all
            </button>
          </fieldset>
        ) : null}

        <div className="c3d-campaigns-result-head">
          <p aria-live="polite">{campaignCountLabel(matched.length)}</p>
          {matched.length > CAMPAIGNS_PAGE_SIZE ? (
            <span>
              Showing {(page - 1) * CAMPAIGNS_PAGE_SIZE + 1}-
              {Math.min(page * CAMPAIGNS_PAGE_SIZE, matched.length)}
            </span>
          ) : null}
        </div>

        {campaigns.length === 0 ? (
          <EmptyCampaigns
            actionLabel="Explore Discovery"
            onAction={() => void navigate({ to: "/discovery" })}
            title="No campaigns yet"
          >
            Start a Discovery campaign when you are ready to find your next
            customer.
          </EmptyCampaigns>
        ) : matched.length === 0 ? (
          <EmptyCampaigns
            actionLabel="Clear filters"
            onAction={() => onSearchChange({})}
            title="No campaigns match these filters."
          >
            Try a different name, status, type, industry or location.
          </EmptyCampaigns>
        ) : (
          <>
            <div className="c3d-campaigns-card">
              <table
                aria-label="Discovery campaigns"
                className="c3d-campaigns-table"
              >
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Location</th>
                    <th>Prospects</th>
                    <th>Status</th>
                    <th>Run by</th>
                    <th className="c3d-campaigns-date">Date</th>
                    <th className="c3d-campaigns-spend">Spend</th>
                    <th className="sr-only">Open campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ campaign: entry }) => (
                    <CampaignRow
                      campaign={entry}
                      key={entry.id}
                      onSelect={selectCampaign}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 ? (
              <nav
                aria-label="Campaign pages"
                className="c3d-campaigns-pagination"
              >
                <button
                  disabled={page === 1}
                  onClick={() =>
                    onSearchChange({ ...search, page: page - 1 || undefined })
                  }
                  type="button"
                >
                  Previous
                </button>
                <span>
                  Page {page} of {pageCount}
                </span>
                <button
                  disabled={page === pageCount}
                  onClick={() => onSearchChange({ ...search, page: page + 1 })}
                  type="button"
                >
                  Next
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function EmptyCampaigns({
  actionLabel,
  children,
  onAction,
  title,
}: {
  actionLabel: string;
  children: React.ReactNode;
  onAction: () => void;
  title: string;
}) {
  return (
    <section className="c3d-campaigns-empty">
      <h2>{title}</h2>
      <p>{children}</p>
      <button
        className="c3d-btn c3d-btn--outline c3d-btn--sm"
        onClick={onAction}
        type="button"
      >
        {actionLabel}
      </button>
    </section>
  );
}
