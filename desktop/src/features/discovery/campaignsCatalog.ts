import type { DiscoveryCampaign } from "./discoveryProvider";

export const CAMPAIGNS_PAGE_SIZE = 15;

export const CAMPAIGN_STATUS_FILTERS = [
  "running",
  "ready",
  "stopped",
  "failed",
] as const;

export type CampaignStatusFilter = (typeof CAMPAIGN_STATUS_FILTERS)[number];

export const CAMPAIGN_SIZE_FILTERS = [
  "none",
  "1-10",
  "11-50",
  "50-plus",
] as const;

export type CampaignSizeFilter = (typeof CAMPAIGN_SIZE_FILTERS)[number];

export const CAMPAIGN_SORTS = [
  "newest",
  "oldest",
  "prospects",
  "name",
] as const;

export type CampaignSort = (typeof CAMPAIGN_SORTS)[number];

export type CampaignCatalogFilters = {
  from?: string;
  industry?: string;
  location?: string;
  q?: string;
  runner?: string;
  size?: CampaignSizeFilter;
  sort?: CampaignSort;
  status?: CampaignStatusFilter;
  to?: string;
  type?: string;
};

export type CampaignCatalogEntry = {
  campaign: DiscoveryCampaign;
  createdAt: number;
  industry: string;
  location: string;
  runner: string;
  searchText: string;
  type: string;
};

export type CampaignCatalog = {
  entries: readonly CampaignCatalogEntry[];
  industries: readonly string[];
  locations: readonly string[];
  runners: readonly string[];
  types: readonly string[];
};

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function optionValues(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function campaignRunnerLabel(campaign: DiscoveryCampaign): string {
  return campaign.runBy?.name.trim() || "Not recorded";
}

export function campaignStatusFilter(
  campaign: DiscoveryCampaign,
): CampaignStatusFilter {
  if (campaign.status === "running") return "running";
  if (campaign.status === "complete") return "ready";
  if (campaign.status === "failed") return "failed";
  return "stopped";
}

export function campaignStatusLabel(campaign: DiscoveryCampaign): string {
  switch (campaignStatusFilter(campaign)) {
    case "running":
      return "Running";
    case "ready":
      return "Ready to review";
    case "failed":
      return "Failed";
    case "stopped":
      return campaign.status === "cancelled" ? "Stopped" : "Ended early";
  }
}

export function createCampaignCatalog(
  campaigns: readonly DiscoveryCampaign[],
): CampaignCatalog {
  const entries = campaigns.map((campaign) => {
    const industry = campaign.industryName.trim();
    const type = campaign.verticalName.trim();
    const location = campaign.location.trim();
    const runner = campaignRunnerLabel(campaign);
    return {
      campaign,
      createdAt: campaign.createdAt ?? 0,
      industry,
      location,
      runner,
      searchText: normalized(
        [campaign.name, industry, type, location].join(" "),
      ),
      type,
    };
  });

  return {
    entries,
    industries: optionValues(entries.map((entry) => entry.industry)),
    locations: optionValues(entries.map((entry) => entry.location)),
    runners: optionValues(entries.map((entry) => entry.runner)),
    types: optionValues(entries.map((entry) => entry.type)),
  };
}

function dateStart(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.floor(time / 1_000) : null;
}

function dateEnd(value: string | undefined): number | null {
  const start = dateStart(value);
  return start === null ? null : start + 86_399;
}

function hasSize(
  campaign: DiscoveryCampaign,
  size: CampaignSizeFilter | undefined,
): boolean {
  switch (size) {
    case "none":
      return campaign.count === 0;
    case "1-10":
      return campaign.count >= 1 && campaign.count <= 10;
    case "11-50":
      return campaign.count >= 11 && campaign.count <= 50;
    case "50-plus":
      return campaign.count > 50;
    default:
      return true;
  }
}

function compareEntries(
  left: CampaignCatalogEntry,
  right: CampaignCatalogEntry,
  sort: CampaignSort,
): number {
  if (sort === "oldest") {
    return (
      left.createdAt - right.createdAt ||
      left.campaign.name.localeCompare(right.campaign.name)
    );
  }
  if (sort === "prospects") {
    return (
      right.campaign.count - left.campaign.count ||
      right.createdAt - left.createdAt ||
      left.campaign.name.localeCompare(right.campaign.name)
    );
  }
  if (sort === "name") {
    return (
      left.campaign.name.localeCompare(right.campaign.name) ||
      right.createdAt - left.createdAt
    );
  }
  return (
    right.createdAt - left.createdAt ||
    left.campaign.name.localeCompare(right.campaign.name)
  );
}

/**
 * Filters the catalog's normalized index. UI components memoize the catalog,
 * so a keystroke only compares prepared strings and never reparses storage.
 */
export function queryCampaignCatalog(
  catalog: CampaignCatalog,
  filters: CampaignCatalogFilters,
): CampaignCatalogEntry[] {
  const query = normalized(filters.q);
  const from = dateStart(filters.from);
  const to = dateEnd(filters.to);
  const sort = filters.sort ?? "newest";

  return catalog.entries
    .filter((entry) => {
      if (query && !entry.searchText.includes(query)) return false;
      if (
        filters.status &&
        campaignStatusFilter(entry.campaign) !== filters.status
      ) {
        return false;
      }
      if (filters.industry && entry.industry !== filters.industry) return false;
      if (filters.type && entry.type !== filters.type) return false;
      if (filters.location && entry.location !== filters.location) return false;
      if (filters.runner && entry.runner !== filters.runner) return false;
      if (!hasSize(entry.campaign, filters.size)) return false;
      if (from !== null && entry.createdAt < from) return false;
      if (to !== null && entry.createdAt > to) return false;
      return true;
    })
    .sort((left, right) => compareEntries(left, right, sort));
}
