import type { ProspectChanges } from "./businessRecordMutations";
import type { StorageLike } from "./discoveryCampaignStore";
import type { DiscoveryCampaignProvider } from "./discoveryProvider";
import type {
  DiscoveryPlace,
  DiscoverySearchRequest,
  DiscoverySearchResponse,
} from "./discoverySearch";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";

/** The owner-facing campaign form permits targets from 1 through 2,000. */
export const MIN_TARGET = 1;
export const MAX_TARGET = 2_000;
export const PUBLISH_CONCURRENCY = 6;
export const PUBLISH_BACKOFF_MS = [400, 800, 1600] as const;
export const SEARCH_BACKOFF_MS = [1_000, 3_000] as const;
export const MAX_RATE_LIMIT_WAITS = 6;
export const MAX_RATE_LIMIT_WAIT_MS = 65_000;

export type DiscoveryContext = {
  /** The private Sales channel that holds business records. */
  channelId: string;
  /** The relay's tenant community id; never the local community id. */
  communityId: TenantCommunityId;
  pubkey: string;
  displayName: string;
  /** Record ids already in Leads. The controller adds what it saves. */
  existingProspectIds: Set<string>;
  /**
   * Names (see `leadNameKey`) of the leads that existed before this run. Leads
   * are one per business name, so a place with one of these names is skipped.
   */
  existingNames: ReadonlySet<string>;
};

export type DiscoveryDeps = {
  storage: StorageLike | null;
  storageKey: string;
  nowSeconds: () => number;
  newId: () => string;
  /** Resolves after `ms`, or rejects with an AbortError when `signal` fires. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  getOwnerPubkey: () => Promise<string>;
  /** Looks up the Sales channel, the signed-in person and existing leads. */
  resolveContext: () => Promise<DiscoveryContext>;
  search: (
    request: DiscoverySearchRequest,
    signal: AbortSignal,
  ) => Promise<DiscoverySearchResponse>;
  prospectId: (place: DiscoveryPlace) => Promise<string>;
  publishProspect: (input: {
    context: DiscoveryContext;
    changes: ProspectChanges;
  }) => Promise<void>;
  postToSales: (input: {
    context: DiscoveryContext;
    content: string;
  }) => Promise<void>;
  leadLink: (prospectId: string) => string;
};

export type DiscoveryController = DiscoveryCampaignProvider & {
  /** Stops any run and drops listeners. The next community builds a new one. */
  dispose: () => void;
  /** Resolves when no run is in flight (tests). */
  whenIdle: () => Promise<void>;
};

export const FIRST_START_ERROR =
  "Pick a location from the list and choose 1 to 2,000 prospects.";
export const STOPPED_ERROR = "The search was stopped before it began.";
