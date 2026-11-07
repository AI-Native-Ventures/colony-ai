import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { RelayEvent } from "@/shared/api/types";

export const BUSINESS_RECORD_SCHEMA_VERSION = 1;
export const KIND_PARTY_HEAD = 30630;
export const KIND_SERVICE_HEAD = 30632;
export const KIND_PROPOSAL_HEAD = 30633;
export const KIND_PROSPECT_HEAD = 30644;
export const KIND_PARTY_ACTION = 47000;
export const KIND_SERVICE_ACTION = 47002;
export const KIND_PROPOSAL_VERSION = 47003;
export const KIND_PROPOSAL_ACCEPTANCE = 47004;
export const KIND_PROPOSAL_CONVERSION_RECEIPT = 47005;
export const KIND_PROSPECT_ACTION = 47034;
export const KIND_QUALIFY_OBSERVATION_HEAD = 30681;
export const KIND_QUALIFY_OBSERVATION_ACTION = 47070;
export const KIND_OUTREACH_LIST_HEAD = 30684;
export const KIND_OUTREACH_LIST_ACTION = 47075;
export const KIND_DISCOVERY_CAMPAIGN_HEAD = 30685;
export const KIND_DISCOVERY_CAMPAIGN_ACTION = 47076;

export const BUSINESS_SCOPE_KINDS = [
  KIND_PARTY_HEAD,
  KIND_SERVICE_HEAD,
  KIND_PROPOSAL_HEAD,
  KIND_PROSPECT_HEAD,
  KIND_QUALIFY_OBSERVATION_HEAD,
  KIND_OUTREACH_LIST_HEAD,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
] as const;

export const BUSINESS_RECORD_QUERY_KINDS = [
  KIND_PARTY_HEAD,
  KIND_SERVICE_HEAD,
  KIND_PROPOSAL_HEAD,
  KIND_PROSPECT_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
  KIND_QUALIFY_OBSERVATION_HEAD,
  KIND_QUALIFY_OBSERVATION_ACTION,
  KIND_OUTREACH_LIST_HEAD,
  KIND_OUTREACH_LIST_ACTION,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_DISCOVERY_CAMPAIGN_ACTION,
] as const;

export type RecordAction = "create" | "update" | "archive" | "restore";
export type ProspectStage =
  | "qualified"
  | "in_conversation"
  | "proposal"
  | "won"
  | "lost";
export type ProspectQualification = "unreviewed" | "qualified" | "not_fit";
export type ProspectActivityKind = "note" | "contact";
export type ProspectOrigin = "manual" | "discovery";

export const QUALIFY_SIGNAL_CODES = [
  "NO_WEBSITE",
  "SITE_DOWN",
  "NO_HTTPS",
  "NOT_MOBILE_FRIENDLY",
  "NO_ONLINE_BOOKING",
  "NO_WHATSAPP_LINK",
  "HAS_WHATSAPP_LINK",
  "RUNNING_ADS",
  "STALE_SITE",
  "SITE_BUILDER",
  "INCUMBENT_BUILDER",
  "SOCIAL_LINKS",
  "PUBLIC_EMAIL",
] as const;

export type QualifySignal = (typeof QUALIFY_SIGNAL_CODES)[number];
export type QualifyObservationState = "observed" | "not_checked";

export type QualifyObservation = {
  signal: QualifySignal;
  state: QualifyObservationState;
  value: string | number | null;
  confidence: number;
  evidenceUrls: string[];
  observedAt: number;
  runId: string;
  notCheckedReason: string | null;
  personalData: boolean;
};

export type QualifyObservationHead = {
  schemaVersion: 1;
  leadId: string;
  runId: string;
  checkedSignals: QualifySignal[];
  observations: QualifyObservation[];
  checkedAt: number;
  sourceActionEventId: string;
};

export type QualifyObservationAction = {
  schemaVersion: 1;
  leadId: string;
  runId: string;
  expectedHeadEventId?: string;
  checkedSignals: QualifySignal[];
  observations: QualifyObservation[];
};

export type OutreachListSourceKind = "manual" | "campaign" | "agent";

export type OutreachListSource = {
  kind: OutreachListSourceKind;
  campaignId: string | null;
};

export type OutreachListMember = {
  leadId: string;
  addedBy: string;
  addedByAgent: boolean;
  addedAt: number;
};

export type OutreachListTemplate = { name: string; language: string };

export type OutreachListHead = {
  schemaVersion: 1;
  listId: string;
  name: string;
  note: string | null;
  status: "active" | "archived";
  source: OutreachListSource;
  defaultTemplate: OutreachListTemplate | null;
  members: OutreachListMember[];
  createdBy: string;
  createdByAgent: boolean;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
  sourceActionEventId: string;
};

export type DiscoveryCampaignStatus =
  | "running"
  | "paused"
  | "complete"
  | "cancelled"
  | "failed";

export type DiscoveryCampaignHead = {
  schemaVersion: 1;
  campaignId: string;
  name: string;
  audience: "businesses" | "people";
  industryName: string;
  verticalId: string;
  verticalName: string;
  pickedTags: string[];
  query: string | null;
  area: string;
  target: number;
  found: number;
  skippedDuplicates: number;
  status: DiscoveryCampaignStatus;
  endNote: string | null;
  runBy: { kind: "person" | "agent"; pubkey: string };
  createdBy: string;
  createdByAgent: boolean;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  sourceActionEventId: string;
};

export type ServiceRecord = {
  serviceId: string;
  name: string;
  description: string;
  currency: string;
  monthlyFeeMinor: number;
  postsPerMonth: number;
  revisionRounds: number;
};

export type ServiceHead = {
  schemaVersion: number;
  serviceId: string;
  status: string;
  service: ServiceRecord;
  sourceActionEventId: string;
};

export type PartyRecord = {
  partyId: string;
  partyType: string;
  displayName: string;
  externalIds: string[];
};

export type ProspectEvidence = {
  title: string;
  url: string;
  excerpt: string;
  observedAt: number;
};

export type ProspectDiscoveryTag = {
  tag: string;
  kind: string;
  picked: boolean;
};

/** Maps fields kept with the prospect for deterministic qualification filters. */
export type ProspectMapsMetadata = {
  ratingHundredths: number | null;
  reviewCount: number | null;
  category: string | null;
  city: string | null;
};

export type ProspectActivity = {
  activityId: string;
  activityKind: ProspectActivityKind;
  content: string;
  proposalId?: string | null;
  proposalVersionEventId?: string | null;
  authorPubkey: string;
  createdAt: number;
};

export type ProspectRecord = {
  prospectId: string;
  party: PartyRecord;
  industry: string;
  vertical: string;
  fitScore?: number | null;
  /** Explicit source for new records. Missing on older prospects. */
  origin?: ProspectOrigin | null;
  /** Tag evidence matched from the provider's returned listing fields. */
  discoveryTags?: ProspectDiscoveryTag[];
  /** Optional Maps snapshot. Older prospect heads do not include this field. */
  maps?: ProspectMapsMetadata | null;
  potentialMonthlyValueMinor?: number | null;
  website: string | null;
  /** Optional media carried by newer discovery providers or imported records. */
  logoUrl?: string | null;
  placePhotoUrl?: string | null;
  contactName: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  /** Optional number to use for WhatsApp instead of the business phone. */
  whatsappPhone?: string | null;
  evidence: ProspectEvidence[];
  lastVerifiedAt: number | null;
  qualification: ProspectQualification;
  saved: boolean;
  stage: ProspectStage;
  lostReason: string | null;
};

/** Omit an empty extension field so older relays can still accept tagless writes. */
export function discoveryTagsField(
  tags: ProspectDiscoveryTag[] | undefined,
): Partial<Pick<ProspectRecord, "discoveryTags">> {
  return tags?.length ? { discoveryTags: tags } : {};
}

export type ProspectHead = {
  schemaVersion: number;
  prospectId: string;
  status: string;
  prospect: ProspectRecord;
  activities: ProspectActivity[];
  sourceActionEventId: string;
};

export type ProposalLine = {
  serviceId: string | null;
  description: string;
  quantityHundredths: number;
  unitAmountMinor: number;
};

export type ProposalVersion = {
  schemaVersion: number;
  proposalId: string;
  prospectPartyId: string;
  namedAcceptorPubkey: string;
  revision: number;
  previousVersionEventId: string | null;
  expiresAt: number | null;
  currency: string;
  lines: ProposalLine[];
  terms: string;
};

export type ProposalHead = {
  schemaVersion: number;
  proposalId: string;
  currentVersionEventId: string;
  currentVersionDigest: string;
  revision: number;
  sourceEventId: string;
};

export type ProposalAcceptanceEvidence = {
  acceptedByName: string;
  acceptedAt: number;
  evidenceReference: string;
  exactTermsConfirmed: boolean;
};

export type ProposalAcceptance = {
  schemaVersion: number;
  proposalId: string;
  proposalVersionEventId: string;
  proposalVersionDigest: string;
  conversionId: string;
  clientId: string;
  workItemId: string;
  draftInvoiceId: string;
  evidence: ProposalAcceptanceEvidence;
};

export type ProposalConversionReceipt = {
  schemaVersion: number;
  conversionId: string;
  proposalId: string;
  proposalVersionEventId: string;
  clientId: string;
  workItemId: string;
  draftInvoiceId: string;
  acceptanceEventId: string;
};

export type BusinessEvent = RelayEvent & { channelId: string; dTag: string };

export function firstTag(event: RelayEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

export function tryParseContent<T>(event: RelayEvent): T | null {
  try {
    return JSON.parse(event.content) as T;
  } catch {
    return null;
  }
}

export function parseContent<T>(event: RelayEvent, label: string): T {
  const value = tryParseContent<T>(event);
  if (value === null) throw new Error(`${label} could not be read.`);
  return value;
}

/**
 * A business-scoped coordinate. `communityId` must be the relay's tenant
 * community id (see `tenantCommunity.ts`), never the desktop's local community
 * id; the type refuses the latter at compile time.
 */
export function businessDTag(
  communityId: TenantCommunityId,
  recordType: string,
  recordId: string,
): string {
  return `business:${communityId}:${recordType}:${recordId}`;
}

export function proposalVersionDTag(
  communityId: TenantCommunityId,
  proposalId: string,
  revision: number,
): string {
  return `${businessDTag(communityId, "proposal", proposalId)}:version:${revision}`;
}

export function latestByDTag<T>(
  events: RelayEvent[],
  parse: (event: RelayEvent) => T | null,
): Array<{ event: RelayEvent; record: T; dTag: string }> {
  const latest = new Map<string, RelayEvent>();
  for (const event of events) {
    const dTag = firstTag(event, "d");
    if (!dTag || parse(event) === null) continue;
    const prior = latest.get(dTag);
    if (
      !prior ||
      event.created_at > prior.created_at ||
      (event.created_at === prior.created_at && event.id > prior.id)
    ) {
      latest.set(dTag, event);
    }
  }
  return [...latest.entries()].map(([dTag, event]) => ({
    event,
    record: parse(event) as T,
    dTag,
  }));
}

export async function stableRecordId(...parts: string[]): Promise<string> {
  const input = new TextEncoder().encode(`colony:w10:${parts.join(":")}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function proposalConversionIds(
  proposalId: string,
  versionEventId: string,
): Promise<{
  conversionId: string;
  clientId: string;
  workItemId: string;
  draftInvoiceId: string;
}> {
  const [conversionId, clientId, workItemId, draftInvoiceId] =
    await Promise.all(
      ["conversion", "client", "work", "invoice"].map((kind) =>
        stableRecordId(kind, proposalId, versionEventId),
      ),
    );
  return { conversionId, clientId, workItemId, draftInvoiceId };
}
