import {
  cloneCampaignQualificationSettings,
  parseCampaignQualificationSettings,
  type CampaignQualificationSettings,
} from "./qualificationCampaign";
import {
  parseDiscoveryLocation,
  type DiscoveryLocation,
} from "./discoveryLocation";
import type {
  DiscoveryAudience,
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryRunStatus,
  DiscoveryRunner,
} from "./discoveryProvider";

export const MAX_MULTI_CITY_LOCATIONS = 10;
const STORE_VERSION = 1;
const MAX_STORED_GROUPS = 500;

export type MultiCityGroupCityState =
  | "waiting"
  | "starting"
  | "continuing"
  | "not_started"
  | "failed";

export type MultiCityGroupCity = {
  cityId: string;
  label: string;
  locationSelection: DiscoveryLocation;
  campaignId: string | null;
  state: MultiCityGroupCityState;
  reason: string | null;
  /** A requested retry of an existing failed campaign. */
  retryRequested?: boolean;
  /** Automatic Find more attempts already used for this city. */
  automaticContinuations?: number;
};

/** A device-local grouping for otherwise normal relay Discovery campaigns. */
export type MultiCityCampaignGroup = {
  groupId: string;
  name: string;
  createdAt: number;
  cities: MultiCityGroupCity[];
  target: number;
  criteria: string;
  qualification: CampaignQualificationSettings;
  verticalId: string;
  verticalName: string;
  industryId: string;
  industryName: string;
  pickedTags: string[];
  audience: DiscoveryAudience;
  runBy: DiscoveryRunner | null | undefined;
  blockedReason: string | null;
};

export type MultiCityCampaignInput = Omit<
  DiscoveryCampaignInput,
  "location" | "locationSelection"
> & {
  locations: readonly DiscoveryLocation[];
};

type MultiCityStoredState = {
  version: typeof STORE_VERSION;
  groups: MultiCityCampaignGroup[];
};

export type MultiCityStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function multiCityStorageKey(communityId: string): string {
  return `colony:discovery-campaign-groups:v1:${communityId}`;
}

export function browserMultiCityStorage(): MultiCityStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
  const parsed = finiteNumber(value);
  return parsed === null || parsed < 0 ? 0 : Math.floor(parsed);
}

function parseCity(value: unknown): MultiCityGroupCity | null {
  const city = asRecord(value);
  const cityId = string(city?.cityId)?.trim();
  const locationSelection = parseDiscoveryLocation(city?.locationSelection);
  const state = string(city?.state);
  if (
    !cityId ||
    !locationSelection ||
    !state ||
    !["waiting", "starting", "continuing", "not_started", "failed"].includes(
      state,
    )
  ) {
    return null;
  }
  return {
    cityId,
    label: string(city?.label)?.trim() || locationSelection.label,
    locationSelection,
    campaignId: string(city?.campaignId),
    state: state as MultiCityGroupCityState,
    reason: string(city?.reason),
    retryRequested: Boolean(city?.retryRequested),
    automaticContinuations: nonNegativeInt(city?.automaticContinuations),
  };
}

function parseGroup(value: unknown): MultiCityCampaignGroup | null {
  const group = asRecord(value);
  const groupId = string(group?.groupId)?.trim();
  const name = string(group?.name)?.trim();
  const cities = Array.isArray(group?.cities)
    ? group.cities.flatMap((city) => {
        const parsed = parseCity(city);
        return parsed ? [parsed] : [];
      })
    : [];
  const target = nonNegativeInt(group?.target);
  const audience = string(group?.audience);
  if (
    !groupId ||
    !name ||
    cities.length < 2 ||
    cities.length > MAX_MULTI_CITY_LOCATIONS ||
    target < 1 ||
    (audience !== "businesses" && audience !== "people")
  ) {
    return null;
  }
  const runner = asRecord(group?.runBy);
  return {
    groupId,
    name,
    createdAt: nonNegativeInt(group?.createdAt),
    cities,
    target,
    criteria: string(group?.criteria) ?? "",
    qualification: parseCampaignQualificationSettings(group?.qualification),
    verticalId: string(group?.verticalId) ?? "",
    verticalName: string(group?.verticalName) ?? "",
    industryId: string(group?.industryId) ?? "",
    industryName: string(group?.industryName) ?? "",
    pickedTags: Array.isArray(group?.pickedTags)
      ? group.pickedTags
          .filter((tag): tag is string => typeof tag === "string")
          .slice(0, 3)
      : [],
    audience,
    runBy: runner
      ? { name: string(runner.name) ?? "", pubkey: string(runner.pubkey) }
      : null,
    blockedReason: string(group?.blockedReason),
  };
}

function emptyState(): MultiCityStoredState {
  return { version: STORE_VERSION, groups: [] };
}

export function readMultiCityState(
  storage: MultiCityStorage | null,
  key: string,
): MultiCityCampaignGroup[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const state = asRecord(JSON.parse(raw));
    if (state?.version !== STORE_VERSION || !Array.isArray(state.groups)) {
      return [];
    }
    return state.groups
      .flatMap((group) => {
        const parsed = parseGroup(group);
        return parsed ? [parsed] : [];
      })
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_STORED_GROUPS);
  } catch {
    return [];
  }
}

export function writeMultiCityState(
  storage: MultiCityStorage | null,
  key: string,
  groups: readonly MultiCityCampaignGroup[],
): boolean {
  if (!storage) return false;
  try {
    const state: MultiCityStoredState = {
      ...emptyState(),
      groups: [...groups]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_STORED_GROUPS),
    };
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function cloneGroup(
  group: MultiCityCampaignGroup,
): MultiCityCampaignGroup {
  return {
    ...group,
    cities: group.cities.map((city) => ({
      ...city,
      locationSelection: {
        ...city.locationSelection,
        boundingBox: city.locationSelection.boundingBox
          ? ([...city.locationSelection.boundingBox] as [
              number,
              number,
              number,
              number,
            ])
          : null,
        nearby: city.locationSelection.nearby?.map((nearby) => ({ ...nearby })),
      },
    })),
    pickedTags: [...group.pickedTags],
    runBy: group.runBy ? { ...group.runBy } : group.runBy,
  };
}

export function locationFingerprint(location: DiscoveryLocation): string {
  return [
    location.kind,
    location.label.trim().toLocaleLowerCase(),
    location.latitude.toFixed(5),
    location.longitude.toFixed(5),
    location.countryCode?.toLocaleUpperCase() ?? "",
  ].join("|");
}

export function uniqueLocations(
  locations: readonly DiscoveryLocation[],
): DiscoveryLocation[] {
  const seen = new Set<string>();
  const unique: DiscoveryLocation[] = [];
  for (const location of locations) {
    const key = locationFingerprint(location);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
    if (unique.length === MAX_MULTI_CITY_LOCATIONS) break;
  }
  return unique;
}

export function shortPlaceName(label: string): string {
  return label.split(",")[0]?.trim() || label.trim();
}

export function campaignNameForCity(name: string, label: string): string {
  const suffix = shortPlaceName(label).slice(0, 117).trimEnd();
  const prefix = name.trim();
  if (!prefix) return suffix.slice(0, 120);
  if (!suffix) return prefix.slice(0, 120);
  const prefixLength = Math.max(0, 120 - suffix.length - 3);
  if (prefixLength === 0) return suffix.slice(0, 120);
  return `${prefix.slice(0, prefixLength).trimEnd()} · ${suffix}`;
}

export function createMultiCityCampaignGroup({
  groupId,
  cityIds,
  input,
  createdAt,
}: {
  groupId: string;
  cityIds: readonly string[];
  input: MultiCityCampaignInput;
  createdAt: number;
}): MultiCityCampaignGroup {
  const locations = uniqueLocations(input.locations);
  if (locations.length < 2) {
    throw new Error("Choose at least two different cities for this campaign.");
  }
  if (cityIds.length < locations.length) {
    throw new Error("Colony could not prepare every city for this campaign.");
  }
  return {
    groupId,
    name: input.name.trim().slice(0, 120),
    createdAt,
    cities: locations.map((location, index) => ({
      cityId: cityIds[index] ?? `${groupId}-${index}`,
      label: location.label,
      locationSelection: location,
      campaignId: null,
      state: "waiting",
      reason: null,
      retryRequested: false,
      automaticContinuations: 0,
    })),
    target: input.target,
    criteria: input.criteria,
    qualification: cloneCampaignQualificationSettings(input.qualification),
    verticalId: input.verticalId,
    verticalName: input.verticalName,
    industryId: input.industryId,
    industryName: input.industryName,
    pickedTags: [...(input.pickedTags ?? [])],
    audience: input.audience,
    runBy: input.runBy,
    blockedReason: null,
  };
}

export function campaignInputForGroupCity(
  group: MultiCityCampaignGroup,
  city: MultiCityGroupCity,
): DiscoveryCampaignInput {
  return {
    name: campaignNameForCity(group.name, city.label),
    location: city.locationSelection.label,
    locationSelection: city.locationSelection,
    target: group.target,
    criteria: group.criteria,
    qualification: cloneCampaignQualificationSettings(group.qualification),
    verticalId: group.verticalId,
    verticalName: group.verticalName,
    industryId: group.industryId,
    industryName: group.industryName,
    pickedTags: [...group.pickedTags],
    audience: group.audience,
    runBy: group.runBy,
  };
}

export function groupForCampaign(
  groups: readonly MultiCityCampaignGroup[],
  campaignId: string,
): MultiCityCampaignGroup | null {
  return (
    groups.find((group) =>
      group.cities.some((city) => city.campaignId === campaignId),
    ) ?? null
  );
}

export function campaignsForGroup(
  group: MultiCityCampaignGroup,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryCampaign[] {
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  return group.cities.flatMap((city) => {
    const campaign = city.campaignId ? byId.get(city.campaignId) : null;
    return campaign ? [campaign] : [];
  });
}

export function groupCityStatus(
  city: MultiCityGroupCity,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryRunStatus | "waiting" | "starting" | "not_started" {
  if (city.state === "continuing") return "running";
  if (city.state === "starting") return "starting";
  const campaign = city.campaignId
    ? campaigns.find((entry) => entry.id === city.campaignId)
    : null;
  if (campaign) return campaign.status;
  if (city.state === "failed") return "failed";
  return city.state === "not_started" ? "not_started" : "waiting";
}

export function groupCampaignStatus(
  group: MultiCityCampaignGroup,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryRunStatus {
  const statuses = group.cities.map((city) => groupCityStatus(city, campaigns));
  if (statuses.includes("running")) return "running";
  if (
    statuses.includes("paused") ||
    statuses.includes("waiting") ||
    statuses.includes("starting")
  )
    return "paused";
  if (group.blockedReason || statuses.includes("failed")) return "failed";
  if (statuses.includes("cancelled")) return "cancelled";
  return "complete";
}

/** The label mirrors the city's live queue state instead of implying a stop. */
export function groupCampaignStatusLabel(
  group: MultiCityCampaignGroup,
  campaigns: readonly DiscoveryCampaign[],
): string {
  const statuses = group.cities.map((city) => groupCityStatus(city, campaigns));
  if (statuses.includes("running")) return "Searching";
  if (statuses.includes("starting")) return "Starting";
  if (group.blockedReason || statuses.includes("failed")) return "Failed";
  if (statuses.includes("waiting") || statuses.includes("not_started")) {
    return "Waiting";
  }
  if (statuses.includes("paused")) return "Paused";
  if (statuses.includes("cancelled")) return "Stopped";
  return "Done";
}

export function groupProgress(
  group: MultiCityCampaignGroup,
  campaigns: readonly DiscoveryCampaign[],
): { count: number; target: number; searching: number } {
  const groupCampaigns = campaignsForGroup(group, campaigns);
  return {
    count: groupCampaigns.reduce((sum, campaign) => sum + campaign.count, 0),
    target: group.target * group.cities.length,
    searching: group.cities.filter((city) => {
      if (city.state === "starting" || city.state === "continuing") return true;
      return (
        city.campaignId !== null &&
        campaigns.find((campaign) => campaign.id === city.campaignId)
          ?.status === "running"
      );
    }).length,
  };
}

export function groupProviderBudgetUsd(
  group: Pick<MultiCityCampaignGroup, "target" | "cities">,
  perProspectUsd: number,
): number {
  return (
    Math.round(group.target * group.cities.length * perProspectUsd * 10_000) /
    10_000
  );
}

export function groupSummaryCampaign(
  group: MultiCityCampaignGroup,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryCampaign {
  const grouped = campaignsForGroup(group, campaigns);
  const progress = groupProgress(group, campaigns);
  const template = grouped[0];
  return {
    id: `group:${group.groupId}`,
    name: group.name,
    audience: group.audience,
    industryId: group.industryId,
    industryName: group.industryName,
    verticalId: group.verticalId,
    verticalName: group.verticalName,
    pickedTags: [...group.pickedTags],
    location: group.cities.map((city) => city.label).join(", "),
    locationSelection: null,
    target: progress.target,
    count: progress.count,
    budgetUsd:
      grouped.reduce((sum, campaign) => sum + campaign.budgetUsd, 0) ||
      (template?.budgetUsd ?? 0) * group.cities.length,
    criteria: group.criteria,
    status: groupCampaignStatus(group, campaigns),
    prospectIds: [
      ...new Set(grouped.flatMap((campaign) => campaign.prospectIds)),
    ],
    created: true,
    runBy: group.runBy,
    simulated: grouped.some((campaign) => campaign.simulated),
    failureReason: group.blockedReason,
    postedInSales: grouped.every((campaign) => campaign.postedInSales),
    createdAt: group.createdAt,
  };
}
