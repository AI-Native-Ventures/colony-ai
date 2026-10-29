/**
 * Durable campaign list for the real discovery runtime. Pure state plus a
 * tolerant JSON codec: the controller owns when to read and write. Campaigns
 * are kept per community in localStorage; the prospects themselves are shared
 * business records.
 */

import type {
  DiscoveryAudience,
  DiscoveryCampaign,
  DiscoveryRunStatus,
  DiscoveryRunner,
} from "./discoveryProvider";
import type {
  DiscoveryPlace,
  DiscoverySearchResponse,
} from "./discoverySearch";
import { resolveVerticalId } from "./taxonomy";

export const MAX_STORED_CAMPAIGNS = 50;
const MAX_TOP_FITS = 5;
/** The server returns 1 to 50 places a page; a stored page is capped the same. */
const MAX_PENDING_PLACES = 50;
const STORE_VERSION = 1;

export type TopFit = { id: string; name: string; fit: number };

/** Run bookkeeping that the screens never see. */
export type CampaignInternals = {
  /** Offset of the next search page. Only moves after a page is fully saved. */
  skip: number;
  /** Per-picked-tag offsets; null means that search stream is exhausted. */
  tagCursors: Array<number | null>;
  /** New offsets held with a paid page until every place on it is saved. */
  pendingTagCursors: Array<number | null> | null;
  pagesFetched: number;
  /** True once the provider has no more results for this search. */
  exhausted: boolean;
  /** Places that were already in Leads, so not added again. */
  skippedDuplicates: number;
  /** The results message still has to be posted in the Sales channel. */
  pendingPost: boolean;
  /** "sending" is written before the post so a crash can never post twice. */
  postState: "none" | "sending" | "posted";
  /** The short "stopped" note was already posted for this campaign. */
  stopNotePosted: boolean;
  /** The best matches found so far, for the Sales message. */
  topFits: TopFit[];
  /**
   * The search page that was paid for but is not fully saved yet. Written the
   * moment a page arrives and cleared only once every place on it is saved, so
   * a failed save, a pause or a restart resumes from it instead of searching
   * (and paying) again.
   */
  pendingPage: DiscoverySearchResponse | null;
};

export type StoredCampaign = DiscoveryCampaign &
  CampaignInternals & {
    runBy: DiscoveryRunner;
    createdAt: number;
    simulated: false;
  };

export type StoredState = {
  version: typeof STORE_VERSION;
  /** Who the list belongs to; a different signed-in identity starts empty. */
  ownerPubkey: string | null;
  currentId: string | null;
  /** Newest first. */
  campaigns: StoredCampaign[];
};

export function storageKey(communityId: string): string {
  return `colony:discovery-campaigns:v1:${communityId}`;
}

export function emptyState(ownerPubkey: string | null = null): StoredState {
  return {
    version: STORE_VERSION,
    ownerPubkey,
    currentId: null,
    campaigns: [],
  };
}

const AUDIENCES: ReadonlySet<string> = new Set<DiscoveryAudience>([
  "businesses",
  "people",
]);
const STATUSES: ReadonlySet<string> = new Set<DiscoveryRunStatus>([
  "running",
  "paused",
  "cancelled",
  "failed",
  "complete",
]);

/** A stored vertical id under today's catalogue; an unknown id stays as saved. */
function currentVerticalId(id: string): string {
  return resolveVerticalId(id) ?? id;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? Math.floor(parsed) : 0;
}

function parseTopFits(value: unknown): TopFit[] {
  if (!Array.isArray(value)) return [];
  const fits: TopFit[] = [];
  for (const entry of value) {
    const row = entry as Record<string, unknown> | null;
    const id = str(row?.id);
    const name = str(row?.name);
    const fit = num(row?.fit);
    if (id && name && fit !== null) fits.push({ id, name, fit });
  }
  return fits.slice(0, MAX_TOP_FITS);
}

function parseStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);
}

function parseTagCursors(
  value: unknown,
  tagCount: number,
): Array<number | null> {
  if (!Array.isArray(value)) return Array.from({ length: tagCount }, () => 0);
  return Array.from({ length: tagCount }, (_, index) => {
    const cursor = value[index];
    return cursor === null ? null : nonNegativeInt(cursor);
  });
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numOrNull(value: unknown): number | null {
  return num(value);
}

function parsePlace(raw: unknown): DiscoveryPlace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return {
    placeId: strOrNull(value.placeId),
    name: str(value.name) ?? "",
    category: strOrNull(value.category),
    subtypes: strOrNull(value.subtypes),
    address: strOrNull(value.address),
    city: strOrNull(value.city),
    state: strOrNull(value.state),
    country: strOrNull(value.country),
    phone: strOrNull(value.phone),
    website: strOrNull(value.website),
    email: strOrNull(value.email),
    rating: numOrNull(value.rating),
    reviews: numOrNull(value.reviews),
    latitude: numOrNull(value.latitude),
    longitude: numOrNull(value.longitude),
    mapsUrl: strOrNull(value.mapsUrl),
    description: strOrNull(value.description),
    businessStatus: strOrNull(value.businessStatus),
  };
}

function parsePendingPage(value: unknown): DiscoverySearchResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.places)) return null;
  const places = page.places.slice(0, MAX_PENDING_PLACES).flatMap((entry) => {
    const place = parsePlace(entry);
    return place ? [place] : [];
  });
  if (places.length === 0) return null;
  const nextSkip = num(page.nextSkip);
  return {
    provider: str(page.provider) ?? "",
    places,
    estimatedCostUsd: num(page.estimatedCostUsd) ?? 0,
    nextSkip: nextSkip !== null && nextSkip >= 0 ? Math.floor(nextSkip) : null,
  };
}

/** Reads one stored campaign; null when it is not usable. */
export function parseCampaign(raw: unknown): StoredCampaign | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const id = str(value.id);
  const name = str(value.name);
  const audience = str(value.audience);
  const status = str(value.status);
  const location = str(value.location);
  const target = num(value.target);
  const runBy = value.runBy as Record<string, unknown> | null | undefined;
  if (
    !id ||
    !name ||
    !audience ||
    !AUDIENCES.has(audience) ||
    !status ||
    !STATUSES.has(status) ||
    location === null ||
    target === null
  ) {
    return null;
  }
  const prospectIds = Array.isArray(value.prospectIds)
    ? value.prospectIds.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const pickedTags = parseStringList(value.pickedTags, 3);
  return {
    id,
    name,
    audience: audience as DiscoveryAudience,
    industryId: str(value.industryId) ?? "",
    industryName: str(value.industryName) ?? "",
    verticalId: currentVerticalId(str(value.verticalId) ?? ""),
    verticalName: str(value.verticalName) ?? "",
    pickedTags,
    location,
    target,
    count: nonNegativeInt(value.count),
    budgetUsd: num(value.budgetUsd) ?? 0,
    criteria: str(value.criteria) ?? "",
    status: status as DiscoveryRunStatus,
    prospectIds,
    created: true,
    simulated: false,
    runBy: {
      name: str(runBy?.name) ?? "",
      pubkey: str(runBy?.pubkey),
    },
    failureReason: str(value.failureReason),
    postedInSales: value.postedInSales === true,
    createdAt: nonNegativeInt(value.createdAt),
    skippedDuplicates: nonNegativeInt(value.skippedDuplicates),
    skip: nonNegativeInt(value.skip),
    tagCursors: parseTagCursors(value.tagCursors, pickedTags.length),
    pendingTagCursors: Array.isArray(value.pendingTagCursors)
      ? parseTagCursors(value.pendingTagCursors, pickedTags.length)
      : null,
    pagesFetched: nonNegativeInt(value.pagesFetched),
    exhausted: value.exhausted === true,
    pendingPost: value.pendingPost === true,
    postState:
      value.postState === "sending" || value.postState === "posted"
        ? value.postState
        : "none",
    stopNotePosted: value.stopNotePosted === true,
    topFits: parseTopFits(value.topFits),
    pendingPage: parsePendingPage(value.pendingPage),
  };
}

/**
 * Reads a saved list. Anything unreadable gives an empty list, never a throw.
 * A restart means nothing is running: "running" becomes "paused" so Resume
 * continues from the stored cursor, and a post that was mid-send is not
 * repeated (it may have gone out), so it is left as sent.
 */
export function parseStoredState(raw: string | null): StoredState {
  if (!raw) return emptyState();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (typeof json !== "object" || json === null) return emptyState();
  const value = json as Record<string, unknown>;
  if (value.version !== STORE_VERSION || !Array.isArray(value.campaigns)) {
    return emptyState();
  }
  const campaigns: StoredCampaign[] = [];
  for (const entry of value.campaigns) {
    const campaign = parseCampaign(entry);
    if (!campaign) continue;
    campaigns.push({
      ...campaign,
      status: campaign.status === "running" ? "paused" : campaign.status,
      pendingPost:
        campaign.postState === "sending" ? false : campaign.pendingPost,
      postState:
        campaign.postState === "sending" ? "posted" : campaign.postState,
    });
  }
  const currentId = str(value.currentId);
  return {
    version: STORE_VERSION,
    ownerPubkey: str(value.ownerPubkey),
    currentId:
      currentId && campaigns.some((campaign) => campaign.id === currentId)
        ? currentId
        : null,
    campaigns: sortAndCap(campaigns),
  };
}

export function serializeState(state: StoredState): string {
  return JSON.stringify(state);
}

function sortAndCap(campaigns: StoredCampaign[]): StoredCampaign[] {
  return [...campaigns]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_STORED_CAMPAIGNS);
}

export function findCampaign(
  state: StoredState,
  id: string | null,
): StoredCampaign | null {
  if (!id) return null;
  return state.campaigns.find((campaign) => campaign.id === id) ?? null;
}

/** Inserts or replaces one campaign; the list stays newest first and capped. */
export function upsertCampaign(
  state: StoredState,
  campaign: StoredCampaign,
): StoredState {
  const exists = state.campaigns.some((entry) => entry.id === campaign.id);
  const campaigns = exists
    ? state.campaigns.map((entry) =>
        entry.id === campaign.id ? campaign : entry,
      )
    : [campaign, ...state.campaigns];
  const capped = sortAndCap(campaigns);
  return {
    ...state,
    campaigns: capped,
    currentId:
      state.currentId && capped.some((entry) => entry.id === state.currentId)
        ? state.currentId
        : (capped[0]?.id ?? null),
  };
}

export function setCurrent(state: StoredState, id: string | null): StoredState {
  return { ...state, currentId: id };
}

/** Keeps the best few by fit; ties keep the earlier find first. */
export function withTopFit(fits: TopFit[], next: TopFit): TopFit[] {
  const merged = [...fits.filter((fit) => fit.id !== next.id), next];
  merged.sort((left, right) => right.fit - left.fit);
  return merged.slice(0, MAX_TOP_FITS);
}

/** The shape the screens read: the stored record without run bookkeeping. */
export function toPublicCampaign(campaign: StoredCampaign): DiscoveryCampaign {
  return {
    id: campaign.id,
    name: campaign.name,
    audience: campaign.audience,
    industryId: campaign.industryId,
    industryName: campaign.industryName,
    verticalId: campaign.verticalId,
    verticalName: campaign.verticalName,
    pickedTags: [...(campaign.pickedTags ?? [])],
    location: campaign.location,
    target: campaign.target,
    count: campaign.count,
    budgetUsd: campaign.budgetUsd,
    criteria: campaign.criteria,
    status: campaign.status,
    prospectIds: [...campaign.prospectIds],
    created: true,
    runBy: { ...campaign.runBy },
    simulated: false,
    failureReason: campaign.failureReason ?? null,
    postedInSales: campaign.postedInSales === true,
    createdAt: campaign.createdAt,
    skippedDuplicates: campaign.skippedDuplicates,
  };
}

/** Minimal storage surface, so tests can fake it and hardened webviews can fail. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readState(
  storage: StorageLike | null,
  key: string,
): StoredState {
  if (!storage) return emptyState();
  try {
    return parseStoredState(storage.getItem(key));
  } catch {
    return emptyState();
  }
}

/** Writes one snapshot. Returns false when storage refused it. */
export function writeState(
  storage: StorageLike | null,
  key: string,
  state: StoredState,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, serializeState(state));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
