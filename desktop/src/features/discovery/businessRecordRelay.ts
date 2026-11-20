import { getChannelMembers } from "@/shared/api/tauriChannels";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { Channel, RelayEvent } from "@/shared/api/types";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import {
  BUSINESS_SCOPE_KINDS,
  businessDTag,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROSPECT_HEAD,
  KIND_SERVICE_HEAD,
  KIND_OUTREACH_LIST_HEAD,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_QUALIFY_OBSERVATION_HEAD,
  latestByDTag,
  tryParseContent,
  type ProposalAcceptance,
  type ProposalConversionReceipt,
  type ProposalHead,
  type ProposalVersion,
  type ProspectHead,
  type ServiceHead,
  type OutreachListHead,
  type DiscoveryCampaignHead,
  type QualifyObservationHead,
} from "./businessRecordContract";
import {
  parseDiscoveryCampaignHead,
  parseOutreachListHead,
  type DiscoveryCampaignHeadView,
  type OutreachListHeadView,
} from "./outreachRecords";
import {
  parseQualifyObservationHead,
  qualifyObservationDTag,
  type QualifyObservationHeadView,
} from "./qualifyRecords";
import { pickSalesStream } from "./salesChannel";

export type BusinessRole = "owner" | "admin" | "member" | "guest" | "bot";

export type BusinessRecords = {
  channelId: string;
  role: BusinessRole | null;
  /** Kinds stopped at the bounded page ceiling. */
  truncated: BusinessRecordTruncation;
  /** Unique relay events loaded for each record kind before parsing heads. */
  loaded: BusinessRecordLoadCounts;
  services: Array<{ eventId: string; record: ServiceHead; dTag: string }>;
  prospects: Array<{ eventId: string; record: ProspectHead; dTag: string }>;
  proposals: Array<{
    eventId: string;
    head: ProposalHead;
    versions: Array<{ eventId: string; record: ProposalVersion }>;
    version: ProposalVersion | null;
    versionEventId: string | null;
    acceptance: ProposalAcceptance | null;
    receipt: ProposalConversionReceipt | null;
    dTag: string;
  }>;
  outreachLists: OutreachListHeadView[];
  discoveryCampaigns: DiscoveryCampaignHeadView[];
  qualificationObservations: QualifyObservationHeadView[];
};

const QUERY_LIMIT = 500;
const SCOPE_CHUNK_SIZE = 128;

export const BUSINESS_RECORD_PAGE_SIZE = QUERY_LIMIT;
export const MAX_BUSINESS_RECORD_PAGES = 40;
export const BUSINESS_RECORD_RETRY_DELAYS_MS = [150, 400] as const;

const BUSINESS_RECORD_COLLECTIONS = [
  "services",
  "prospects",
  "proposalHeads",
  "proposalVersions",
  "proposalAcceptances",
  "proposalReceipts",
  "outreachLists",
  "discoveryCampaigns",
  "qualificationObservations",
] as const;

export type BusinessRecordCollection =
  (typeof BUSINESS_RECORD_COLLECTIONS)[number];

export type BusinessRecordTruncation = Partial<
  Record<BusinessRecordCollection, true>
>;

export type BusinessRecordLoadCounts = Record<BusinessRecordCollection, number>;

export type BusinessRecordLoadDependencies = {
  fetchEvents?: (filter: RelaySubscriptionFilter) => Promise<RelayEvent[]>;
  /** Fetches independently limited filters through one paced Nostr REQ. */
  fetchEventsForFilters?: (
    filters: readonly RelaySubscriptionFilter[],
  ) => Promise<RelayEvent[]>;
  getChannelMembers?: typeof getChannelMembers;
  getRelaySelf?: typeof getRelaySelf;
  /** Used by retries so an abandoned query never waits in the background. */
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
};

type PagedRecordEvents = {
  events: RelayEvent[];
  truncated: boolean;
};

type RecordPageInput = {
  kind: number;
  authors?: string[];
};

type RecordPageDependencies = Required<
  Pick<
    BusinessRecordLoadDependencies,
    "fetchEvents" | "fetchEventsForFilters" | "sleep"
  >
> &
  Pick<BusinessRecordLoadDependencies, "signal">;

function channelIdOf(event: { tags: string[][] }): string | null {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

function businessCandidates(channels: Channel[]): Channel[] {
  return channels.filter(
    (channel) =>
      channel.visibility === "private" &&
      channel.channelType === "stream" &&
      channel.isMember &&
      channel.archivedAt === null,
  );
}

/** Every private stream the person can see that is named "Sales". */
export function salesStreamsOf(channels: Channel[]): Channel[] {
  return businessCandidates(channels).filter(
    (channel) => channel.name.trim().toLocaleLowerCase() === "sales",
  );
}

export async function resolveBusinessChannel(
  channels: Channel[],
): Promise<string | null> {
  const candidates = businessCandidates(channels);
  const availableIds = new Set(candidates.map((channel) => channel.id));
  const discoveredChannelIds = new Set<string>();
  for (let start = 0; start < candidates.length; start += SCOPE_CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + SCOPE_CHUNK_SIZE);
    const events = await relayClient.fetchEvents({
      kinds: [...BUSINESS_SCOPE_KINDS],
      limit: QUERY_LIMIT,
      "#h": chunk.map((channel) => channel.id),
    });
    for (const event of events) {
      if (!BUSINESS_SCOPE_KINDS.some((kind) => kind === event.kind)) continue;
      const channelId = channelIdOf(event);
      if (channelId && availableIds.has(channelId)) {
        discoveredChannelIds.add(channelId);
      }
    }
  }
  if (discoveredChannelIds.size > 1) {
    throw new Error("Business records are split across private streams.");
  }
  if (discoveredChannelIds.size === 1) {
    return [...discoveredChannelIds][0];
  }

  // Two empty Sales streams (a create race) are not a dead end: every device
  // picks the same one, so records land in one place.
  return pickSalesStream(salesStreamsOf(channels))?.id ?? null;
}

function abortedLoadError(): Error {
  const error = new Error("Business record loading was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedLoadError();
}

function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedLoadError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortedLoadError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryablePageError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|connection|socket|network|websocket|closed|disconnected|unavailable/i.test(
    message,
  );
}

async function fetchRecordPage(
  filter: RelaySubscriptionFilter,
  dependencies: RecordPageDependencies,
): Promise<RelayEvent[]> {
  for (
    let attempt = 0;
    attempt <= BUSINESS_RECORD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    throwIfAborted(dependencies.signal);
    try {
      return await dependencies.fetchEvents(filter);
    } catch (error) {
      const delay = BUSINESS_RECORD_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryablePageError(error)) throw error;
      await dependencies.sleep(delay, dependencies.signal);
    }
  }
  throw new Error("Business record paging exhausted unexpectedly.");
}

async function fetchRecordPageBatch(
  filters: readonly RelaySubscriptionFilter[],
  dependencies: RecordPageDependencies,
): Promise<RelayEvent[]> {
  for (
    let attempt = 0;
    attempt <= BUSINESS_RECORD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    throwIfAborted(dependencies.signal);
    try {
      return await dependencies.fetchEventsForFilters(filters);
    } catch (error) {
      const delay = BUSINESS_RECORD_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryablePageError(error)) throw error;
      await dependencies.sleep(delay, dependencies.signal);
    }
  }
  throw new Error("Business record batch paging exhausted unexpectedly.");
}

function recordPageFilter(
  channelId: string,
  input: RecordPageInput,
  until: number | undefined,
): RelaySubscriptionFilter {
  return {
    kinds: [input.kind],
    limit: BUSINESS_RECORD_PAGE_SIZE,
    "#h": [channelId],
    ...(input.authors ? { authors: input.authors } : {}),
    ...(until === undefined ? {} : { until }),
  };
}

async function fetchAllRecordPages(
  input: {
    channelId: string;
    kind: number;
    authors?: string[];
  },
  initialPageEvents: RelayEvent[],
  dependencies: RecordPageDependencies,
): Promise<PagedRecordEvents> {
  const events: RelayEvent[] = [];
  const seenIds = new Set<string>();
  let until: number | undefined;

  for (let page = 0; page < MAX_BUSINESS_RECORD_PAGES; page += 1) {
    throwIfAborted(dependencies.signal);
    const pageEvents =
      page === 0
        ? initialPageEvents
        : await fetchRecordPage(
            recordPageFilter(input.channelId, input, until),
            dependencies,
          );
    const added = pageEvents.filter((event) => {
      if (seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      events.push(event);
      return true;
    });
    const oldestCreatedAt = pageEvents.reduce<number | null>(
      (oldest, event) =>
        oldest === null || event.created_at < oldest
          ? event.created_at
          : oldest,
      null,
    );

    if (pageEvents.length < BUSINESS_RECORD_PAGE_SIZE) {
      return { events, truncated: false };
    }
    // A full inclusive boundary page without a new id cannot safely advance
    // without skipping records that share its timestamp. Surface the partial
    // result instead of presenting it as a complete history.
    if (added.length === 0) return { events, truncated: true };
    if (page === MAX_BUSINESS_RECORD_PAGES - 1) {
      return { events, truncated: true };
    }
    if (oldestCreatedAt === null) return { events, truncated: false };
    until = oldestCreatedAt;
  }
  return { events, truncated: false };
}

function loadCounts(
  input: Record<BusinessRecordCollection, PagedRecordEvents>,
) {
  return Object.fromEntries(
    BUSINESS_RECORD_COLLECTIONS.map((collection) => [
      collection,
      input[collection].events.length,
    ]),
  ) as BusinessRecordLoadCounts;
}

function truncation(
  input: Record<BusinessRecordCollection, PagedRecordEvents>,
) {
  return Object.fromEntries(
    BUSINESS_RECORD_COLLECTIONS.filter(
      (collection) => input[collection].truncated,
    ).map((collection) => [collection, true]),
  ) as BusinessRecordTruncation;
}

export async function loadBusinessRecords(
  channelId: string,
  communityId: TenantCommunityId,
  currentPubkey: string,
  inputDependencies: BusinessRecordLoadDependencies = {},
): Promise<BusinessRecords> {
  const fetchEvents =
    inputDependencies.fetchEvents ?? relayClient.fetchEvents.bind(relayClient);
  const dependencies: RecordPageDependencies = {
    fetchEvents,
    fetchEventsForFilters:
      inputDependencies.fetchEventsForFilters ??
      (inputDependencies.fetchEvents
        ? async (filters) => {
            const pages = await Promise.all(
              filters.map((filter) => fetchEvents(filter)),
            );
            return pages.flat();
          }
        : relayClient.fetchEventsForFilters.bind(relayClient)),
    sleep: inputDependencies.sleep ?? abortableSleep,
    signal: inputDependencies.signal,
  };
  const getChannelMembersForLoad =
    inputDependencies.getChannelMembers ?? getChannelMembers;
  const getRelaySelfForLoad = inputDependencies.getRelaySelf ?? getRelaySelf;
  const primaryRecordInputs: readonly RecordPageInput[] = [
    { kind: KIND_SERVICE_HEAD },
    { kind: KIND_PROSPECT_HEAD },
    { kind: KIND_PROPOSAL_HEAD },
    { kind: KIND_PROPOSAL_VERSION },
    { kind: KIND_PROPOSAL_ACCEPTANCE },
    { kind: KIND_PROPOSAL_CONVERSION_RECEIPT },
  ];

  throwIfAborted(dependencies.signal);
  const [
    primaryPageEvents,
    relaySelf,
    members,
  ] = await Promise.all([
    fetchRecordPageBatch(
      primaryRecordInputs.map((input) =>
        recordPageFilter(channelId, input, undefined),
      ),
      dependencies,
    ),
    getRelaySelfForLoad(),
    getChannelMembersForLoad(channelId),
  ]);
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const relaySignedRecordInputs: readonly RecordPageInput[] = [
    { kind: KIND_OUTREACH_LIST_HEAD, authors: [relaySelf] },
    { kind: KIND_DISCOVERY_CAMPAIGN_HEAD, authors: [relaySelf] },
    { kind: KIND_QUALIFY_OBSERVATION_HEAD, authors: [relaySelf] },
  ];
  const relaySignedPageEvents = await fetchRecordPageBatch(
    relaySignedRecordInputs.map((input) =>
      recordPageFilter(channelId, input, undefined),
    ),
    dependencies,
  );
  const initialEventsForKind = (events: RelayEvent[], kind: number) =>
    events.filter((event) => event.kind === kind);
  const [
    servicesPage,
    prospectsPage,
    proposalHeadsPage,
    proposalVersionsPage,
    acceptancesPage,
    receiptsPage,
    outreachListsPage,
    discoveryCampaignsPage,
    qualificationsPage,
  ] = await Promise.all([
    fetchAllRecordPages(
      { channelId, kind: KIND_SERVICE_HEAD },
      initialEventsForKind(primaryPageEvents, KIND_SERVICE_HEAD),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_PROSPECT_HEAD },
      initialEventsForKind(primaryPageEvents, KIND_PROSPECT_HEAD),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_PROPOSAL_HEAD },
      initialEventsForKind(primaryPageEvents, KIND_PROPOSAL_HEAD),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_PROPOSAL_VERSION },
      initialEventsForKind(primaryPageEvents, KIND_PROPOSAL_VERSION),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_PROPOSAL_ACCEPTANCE },
      initialEventsForKind(primaryPageEvents, KIND_PROPOSAL_ACCEPTANCE),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_PROPOSAL_CONVERSION_RECEIPT },
      initialEventsForKind(primaryPageEvents, KIND_PROPOSAL_CONVERSION_RECEIPT),
      dependencies,
    ),
    fetchAllRecordPages(
      { channelId, kind: KIND_OUTREACH_LIST_HEAD, authors: [relaySelf] },
      initialEventsForKind(relaySignedPageEvents, KIND_OUTREACH_LIST_HEAD),
      dependencies,
    ),
    fetchAllRecordPages(
      {
        channelId,
        kind: KIND_DISCOVERY_CAMPAIGN_HEAD,
        authors: [relaySelf],
      },
      initialEventsForKind(
        relaySignedPageEvents,
        KIND_DISCOVERY_CAMPAIGN_HEAD,
      ),
      dependencies,
    ),
    fetchAllRecordPages(
      {
        channelId,
        kind: KIND_QUALIFY_OBSERVATION_HEAD,
        authors: [relaySelf],
      },
      initialEventsForKind(
        relaySignedPageEvents,
        KIND_QUALIFY_OBSERVATION_HEAD,
      ),
      dependencies,
    ),
  ]);
  const pagedRecords = {
    services: servicesPage,
    prospects: prospectsPage,
    proposalHeads: proposalHeadsPage,
    proposalVersions: proposalVersionsPage,
    proposalAcceptances: acceptancesPage,
    proposalReceipts: receiptsPage,
    outreachLists: outreachListsPage,
    discoveryCampaigns: discoveryCampaignsPage,
    qualificationObservations: qualificationsPage,
  };
  const serviceEvents = servicesPage.events;
  const prospectEvents = prospectsPage.events;
  const proposalHeadEvents = proposalHeadsPage.events;
  const proposalVersionEvents = proposalVersionsPage.events;
  const acceptanceEvents = acceptancesPage.events;
  const receiptEvents = receiptsPage.events;
  const outreachListEvents = outreachListsPage.events;
  const discoveryCampaignEvents = discoveryCampaignsPage.events;
  const qualificationEvents = qualificationsPage.events;
  const role = members.find(
    (member) =>
      member.pubkey.toLocaleLowerCase() === currentPubkey.toLocaleLowerCase(),
  )?.role as BusinessRole | undefined;
  const services = latestByDTag<ServiceHead>(serviceEvents, (event) =>
    tryParseContent<ServiceHead>(event),
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    record,
    dTag,
  }));
  const prospects = latestByDTag<ProspectHead>(prospectEvents, (event) =>
    tryParseContent<ProspectHead>(event),
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    record,
    dTag,
  }));
  const proposalHeads = latestByDTag<ProposalHead>(
    proposalHeadEvents,
    (event) => tryParseContent<ProposalHead>(event),
  );
  const versionsById = new Map(
    proposalVersionEvents.map((event) => [
      event.id,
      tryParseContent<ProposalVersion>(event),
    ]),
  );
  const acceptances = latestByDTag<ProposalAcceptance>(
    acceptanceEvents,
    (event) => tryParseContent<ProposalAcceptance>(event),
  );
  const receipts = latestByDTag<ProposalConversionReceipt>(
    receiptEvents,
    (event) => tryParseContent<ProposalConversionReceipt>(event),
  );
  const proposals = proposalHeads.map(({ event, record, dTag }) => {
    const version = versionsById.get(record.currentVersionEventId) ?? null;
    const versions = proposalVersionEvents
      .flatMap((versionEvent) => {
        const parsed = tryParseContent<ProposalVersion>(versionEvent);
        return parsed?.proposalId === record.proposalId
          ? [{ eventId: versionEvent.id, record: parsed }]
          : [];
      })
      .sort((left, right) => left.record.revision - right.record.revision);
    const acceptance =
      acceptances.find(
        (candidate) =>
          candidate.record.proposalId === record.proposalId &&
          candidate.record.proposalVersionEventId ===
            record.currentVersionEventId,
      )?.record ?? null;
    const receipt =
      receipts.find(
        (candidate) =>
          candidate.record.proposalId === record.proposalId &&
          candidate.record.proposalVersionEventId ===
            record.currentVersionEventId,
      )?.record ?? null;
    return {
      eventId: event.id,
      head: record,
      versions,
      version,
      versionEventId: version ? record.currentVersionEventId : null,
      acceptance,
      receipt,
      dTag,
    };
  });
  const outreachLists = latestByDTag<OutreachListHead>(
    outreachListEvents,
    (event) =>
      parseOutreachListHead(event, communityId, channelId)?.record ?? null,
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    dTag,
    record,
  }));
  const discoveryCampaigns = latestByDTag<DiscoveryCampaignHead>(
    discoveryCampaignEvents,
    (event) =>
      parseDiscoveryCampaignHead(event, communityId, channelId)?.record ?? null,
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    dTag,
    record,
  }));
  const qualificationObservations = latestByDTag<QualifyObservationHead>(
    qualificationEvents,
    (event) =>
      parseQualifyObservationHead(event, communityId, channelId)?.record ??
      null,
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    dTag,
    record,
  }));
  return {
    channelId,
    role: role ?? null,
    truncated: truncation(pagedRecords),
    loaded: loadCounts(pagedRecords),
    services,
    prospects,
    proposals,
    outreachLists,
    discoveryCampaigns,
    qualificationObservations,
  };
}

/** Fresh relay view used to make campaign backfill retries idempotent. */
export async function loadDiscoveryCampaignHeads(
  channelId: string,
  communityId: TenantCommunityId,
): Promise<DiscoveryCampaignHeadView[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_DISCOVERY_CAMPAIGN_HEAD],
    authors: [relaySelf],
    limit: QUERY_LIMIT,
    "#h": [channelId],
  });
  return latestByDTag<DiscoveryCampaignHead>(
    events,
    (event) =>
      parseDiscoveryCampaignHead(event, communityId, channelId)?.record ?? null,
  ).map(({ event, record, dTag }) => ({
    eventId: event.id,
    dTag,
    record,
  }));
}

/** Reads one current prospect head for a retryable bulk stage update. */
export async function loadProspectHead(
  channelId: string,
  communityId: TenantCommunityId,
  prospectId: string,
): Promise<{ eventId: string; record: ProspectHead } | null> {
  const dTag = businessDTag(communityId, "prospect", prospectId);
  const events = await relayClient.fetchEvents({
    kinds: [KIND_PROSPECT_HEAD],
    limit: QUERY_LIMIT,
    "#h": [channelId],
    "#d": [dTag],
  });
  const current = latestByDTag<ProspectHead>(events, (event) => {
    const record = tryParseContent<ProspectHead>(event);
    return record?.prospectId === prospectId &&
      record.prospect?.prospectId === prospectId
      ? record
      : null;
  }).find((candidate) => candidate.dTag === dTag);
  return current ? { eventId: current.event.id, record: current.record } : null;
}

/** Reads one current qualification head before an idempotent retry or replacement. */
export async function loadQualifyObservationHead(
  channelId: string,
  communityId: TenantCommunityId,
  leadId: string,
): Promise<QualifyObservationHeadView | null> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const dTag = qualifyObservationDTag(communityId, leadId);
  const events = await relayClient.fetchEvents({
    kinds: [KIND_QUALIFY_OBSERVATION_HEAD],
    authors: [relaySelf],
    limit: QUERY_LIMIT,
    "#h": [channelId],
    "#d": [dTag],
  });
  const current = latestByDTag<QualifyObservationHead>(
    events,
    (event) =>
      parseQualifyObservationHead(event, communityId, channelId)?.record ??
      null,
  ).find((candidate) => candidate.dTag === dTag);
  return current
    ? { eventId: current.event.id, dTag: current.dTag, record: current.record }
    : null;
}

export async function publishBusinessCommand(input: {
  kind: number;
  channelId: string;
  dTag: string;
  content: unknown;
}): Promise<string> {
  const event = await signRelayEvent({
    kind: input.kind,
    content: JSON.stringify(input.content),
    tags: [
      ["h", input.channelId],
      ["d", input.dTag],
    ],
  });
  await relayClient.publishEvent(
    event,
    "The update timed out. Retry to check whether it was saved.",
    "The update could not be saved.",
  );
  return event.id;
}
