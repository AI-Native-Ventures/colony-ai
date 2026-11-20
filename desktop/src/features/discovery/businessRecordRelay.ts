import { getChannelMembers } from "@/shared/api/tauriChannels";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { Channel, RelayEvent } from "@/shared/api/types";
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

const PRIMARY_RECORD_KINDS = [
  KIND_SERVICE_HEAD,
  KIND_PROSPECT_HEAD,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
] as const;

const RELAY_SIGNED_RECORD_KINDS = [
  KIND_OUTREACH_LIST_HEAD,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_QUALIFY_OBSERVATION_HEAD,
] as const;

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

export async function loadBusinessRecords(
  channelId: string,
  communityId: TenantCommunityId,
  currentPubkey: string,
): Promise<BusinessRecords> {
  const [primaryEvents, relaySelf, members] = await Promise.all([
    // One REQ can carry several filters. Keeping one filter per kind preserves
    // the existing 500-event ceiling for every record family while reducing a
    // dense Sales screen from six admissions to one.
    relayClient.fetchEventsForFilters(
      PRIMARY_RECORD_KINDS.map((kind) => ({
        kinds: [kind],
        limit: QUERY_LIMIT,
        "#h": [channelId],
      })),
    ),
    getRelaySelf(),
    getChannelMembers(channelId),
  ]);
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  // Relay-signed records are a second filter batch because the relay identity
  // is learned alongside the primary records. This replaces three admissions
  // without relaxing author scoping or any per-kind result limit.
  const relaySignedEvents = await relayClient.fetchEventsForFilters(
    RELAY_SIGNED_RECORD_KINDS.map((kind) => ({
      kinds: [kind],
      authors: [relaySelf],
      limit: QUERY_LIMIT,
      "#h": [channelId],
    })),
  );
  const serviceEvents = primaryEvents.filter(
    (event) => event.kind === KIND_SERVICE_HEAD,
  );
  const prospectEvents = primaryEvents.filter(
    (event) => event.kind === KIND_PROSPECT_HEAD,
  );
  const proposalHeadEvents = primaryEvents.filter(
    (event) => event.kind === KIND_PROPOSAL_HEAD,
  );
  const proposalVersionEvents = primaryEvents.filter(
    (event) => event.kind === KIND_PROPOSAL_VERSION,
  );
  const acceptanceEvents = primaryEvents.filter(
    (event) => event.kind === KIND_PROPOSAL_ACCEPTANCE,
  );
  const receiptEvents = primaryEvents.filter(
    (event) => event.kind === KIND_PROPOSAL_CONVERSION_RECEIPT,
  );
  const outreachListEvents = relaySignedEvents.filter(
    (event) => event.kind === KIND_OUTREACH_LIST_HEAD,
  );
  const discoveryCampaignEvents = relaySignedEvents.filter(
    (event) => event.kind === KIND_DISCOVERY_CAMPAIGN_HEAD,
  );
  const qualificationEvents = relaySignedEvents.filter(
    (event) => event.kind === KIND_QUALIFY_OBSERVATION_HEAD,
  );
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
