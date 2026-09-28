import { getChannelMembers } from "@/shared/api/tauriChannels";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { Channel, RelayEvent } from "@/shared/api/types";
import {
  BUSINESS_SCOPE_KINDS,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROSPECT_HEAD,
  KIND_SERVICE_HEAD,
  latestByDTag,
  tryParseContent,
  type ProposalAcceptance,
  type ProposalConversionReceipt,
  type ProposalHead,
  type ProposalVersion,
  type ProspectHead,
  type ServiceHead,
} from "./businessRecordContract";

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
};

const QUERY_LIMIT = 500;
const SCOPE_CHUNK_SIZE = 128;

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

  const salesStreams = candidates.filter(
    (channel) => channel.name.trim().toLocaleLowerCase() === "sales",
  );
  if (salesStreams.length === 1) return salesStreams[0].id;
  if (salesStreams.length > 1) {
    throw new Error("More than one private Sales stream is available.");
  }
  return null;
}

async function fetchKind(
  channelId: string,
  kind: number,
): Promise<RelayEvent[]> {
  return relayClient.fetchEvents({
    kinds: [kind],
    limit: QUERY_LIMIT,
    "#h": [channelId],
  });
}

export async function loadBusinessRecords(
  channelId: string,
  currentPubkey: string,
): Promise<BusinessRecords> {
  const [
    serviceEvents,
    prospectEvents,
    proposalHeadEvents,
    proposalVersionEvents,
    acceptanceEvents,
    receiptEvents,
    members,
  ] = await Promise.all([
    fetchKind(channelId, KIND_SERVICE_HEAD),
    fetchKind(channelId, KIND_PROSPECT_HEAD),
    fetchKind(channelId, KIND_PROPOSAL_HEAD),
    fetchKind(channelId, KIND_PROPOSAL_VERSION),
    fetchKind(channelId, KIND_PROPOSAL_ACCEPTANCE),
    fetchKind(channelId, KIND_PROPOSAL_CONVERSION_RECEIPT),
    getChannelMembers(channelId),
  ]);
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
  return {
    channelId,
    role: role ?? null,
    services,
    prospects,
    proposals,
  };
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
