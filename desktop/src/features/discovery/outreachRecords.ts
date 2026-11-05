import {
  businessDTag,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_OUTREACH_LIST_HEAD,
  tryParseContent,
  type DiscoveryCampaignHead,
  type OutreachListHead,
  type OutreachListSource,
  type OutreachListTemplate,
} from "./businessRecordContract";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { RelayEvent } from "@/shared/api/types";

export const MAX_OUTREACH_LIST_LEADS = 500;

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX64_PATTERN = /^[a-f0-9]{64}$/i;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_.-]{1,128}$/i;

export type OutreachListHeadView = {
  eventId: string;
  dTag: string;
  record: OutreachListHead;
};

export type DiscoveryCampaignHeadView = {
  eventId: string;
  dTag: string;
  record: DiscoveryCampaignHead;
};

export type CreateOutreachListAction = {
  schemaVersion: 1;
  listId: string;
  op: "create";
  name: string;
  source: OutreachListSource;
  leadIds?: string[];
  note?: string;
  defaultTemplate?: OutreachListTemplate;
};

export type OutreachListMutation =
  | {
      schemaVersion: 1;
      listId: string;
      op: "rename";
      expectedHeadEventId?: string;
      name?: string;
      note?: string;
    }
  | {
      schemaVersion: 1;
      listId: string;
      op: "add_members" | "remove_members";
      expectedHeadEventId?: string;
      leadIds: string[];
    }
  | {
      schemaVersion: 1;
      listId: string;
      op: "set_default_template";
      expectedHeadEventId?: string;
      defaultTemplate?: OutreachListTemplate;
    }
  | {
      schemaVersion: 1;
      listId: string;
      op: "archive" | "unarchive";
      expectedHeadEventId?: string;
    };

export type DiscoveryCampaignAction =
  | {
      schemaVersion: 1;
      campaignId: string;
      op: "create";
      name: string;
      audience: "businesses" | "people";
      industryName: string;
      verticalId: string;
      verticalName: string;
      pickedTags?: string[];
      query?: string;
      area: string;
      target: number;
      found?: number;
      skippedDuplicates?: number;
      status: DiscoveryCampaignHead["status"];
      endNote?: string;
      runBy?: DiscoveryCampaignHead["runBy"];
    }
  | {
      schemaVersion: 1;
      campaignId: string;
      op: "progress";
      expectedHeadEventId?: string;
      found: number;
      skippedDuplicates: number;
      status?: "running" | "paused";
    }
  | {
      schemaVersion: 1;
      campaignId: string;
      op: "finish";
      expectedHeadEventId?: string;
      found: number;
      skippedDuplicates: number;
      status: "complete" | "cancelled" | "failed";
      endNote?: string;
    }
  | {
      schemaVersion: 1;
      campaignId: string;
      op: "rename";
      expectedHeadEventId?: string;
      name: string;
    }
  | {
      schemaVersion: 1;
      campaignId: string;
      op: "archive";
      expectedHeadEventId?: string;
    };

export type DiscoveryCampaignMutation = Exclude<
  DiscoveryCampaignAction,
  { op: "create" }
>;

export function outreachListDTag(
  communityId: TenantCommunityId,
  listId: string,
): string {
  return businessDTag(communityId, "outreach_list", listId.toLowerCase());
}

export function discoveryCampaignDTag(
  communityId: TenantCommunityId,
  campaignId: string,
): string {
  return businessDTag(
    communityId,
    "discovery_campaign",
    campaignId.toLowerCase(),
  );
}

function stringValue(value: unknown): value is string {
  return typeof value === "string";
}

function integerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 0x1f || code === 0x7f);
  });
}

function validName(value: unknown, maxLength: number): value is string {
  return (
    stringValue(value) &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength &&
    !hasControlCharacters(value)
  );
}

function validTemplate(value: unknown): value is OutreachListTemplate {
  return (
    objectValue(value) &&
    stringValue(value.name) &&
    TEMPLATE_NAME_PATTERN.test(value.name) &&
    stringValue(value.language) &&
    /^[a-z0-9_-]{1,16}$/i.test(value.language)
  );
}

function validListMember(value: unknown): boolean {
  return (
    objectValue(value) &&
    stringValue(value.leadId) &&
    UUID_PATTERN.test(value.leadId) &&
    stringValue(value.addedBy) &&
    HEX64_PATTERN.test(value.addedBy) &&
    typeof value.addedByAgent === "boolean" &&
    integerValue(value.addedAt)
  );
}

function readTag(event: RelayEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

export function parseOutreachListHead(
  event: RelayEvent,
  communityId: TenantCommunityId,
  channelId: string,
): OutreachListHeadView | null {
  if (event.kind !== KIND_OUTREACH_LIST_HEAD) return null;
  if (readTag(event, "h") !== channelId) return null;
  const content = tryParseContent<Record<string, unknown>>(event);
  if (content?.schemaVersion !== 1) return null;
  const listId = content.listId;
  if (!stringValue(listId) || !UUID_PATTERN.test(listId)) return null;
  const dTag = outreachListDTag(communityId, listId);
  if (readTag(event, "d") !== dTag) return null;
  if (!validName(content.name, 80)) return null;
  if (content.note !== null && !stringValue(content.note)) return null;
  if (
    stringValue(content.note) &&
    (content.note.length > 500 || hasControlCharacters(content.note))
  ) {
    return null;
  }
  if (content.status !== "active" && content.status !== "archived") return null;
  if (!objectValue(content.source)) return null;
  const sourceKind = content.source.kind;
  const campaignId = content.source.campaignId;
  if (
    !(["manual", "campaign", "agent"] as const).includes(sourceKind as never)
  ) {
    return null;
  }
  if (
    (campaignId !== null &&
      (!stringValue(campaignId) || !UUID_PATTERN.test(campaignId))) ||
    (sourceKind === "campaign" && !stringValue(campaignId))
  ) {
    return null;
  }
  if (
    content.defaultTemplate !== null &&
    !validTemplate(content.defaultTemplate)
  ) {
    return null;
  }
  if (
    !Array.isArray(content.members) ||
    content.members.length > MAX_OUTREACH_LIST_LEADS ||
    !content.members.every(validListMember)
  ) {
    return null;
  }
  const memberIds = content.members.map(
    (member) => (member as { leadId: string }).leadId,
  );
  if (new Set(memberIds).size !== memberIds.length) return null;
  if (
    !stringValue(content.createdBy) ||
    !HEX64_PATTERN.test(content.createdBy) ||
    typeof content.createdByAgent !== "boolean" ||
    !integerValue(content.createdAt) ||
    !stringValue(content.updatedBy) ||
    !HEX64_PATTERN.test(content.updatedBy) ||
    !integerValue(content.updatedAt) ||
    !stringValue(content.sourceActionEventId) ||
    !HEX64_PATTERN.test(content.sourceActionEventId)
  ) {
    return null;
  }
  return {
    eventId: event.id,
    dTag,
    record: content as unknown as OutreachListHead,
  };
}

export function parseDiscoveryCampaignHead(
  event: RelayEvent,
  communityId: TenantCommunityId,
  channelId: string,
): DiscoveryCampaignHeadView | null {
  if (event.kind !== KIND_DISCOVERY_CAMPAIGN_HEAD) return null;
  if (readTag(event, "h") !== channelId) return null;
  const content = tryParseContent<Record<string, unknown>>(event);
  if (content?.schemaVersion !== 1) return null;
  const campaignId = content.campaignId;
  if (!stringValue(campaignId) || !UUID_PATTERN.test(campaignId)) return null;
  const dTag = discoveryCampaignDTag(communityId, campaignId);
  if (readTag(event, "d") !== dTag) return null;
  if (!validName(content.name, 120)) return null;
  if (content.audience !== "businesses" && content.audience !== "people") {
    return null;
  }
  if (
    !stringValue(content.industryName) ||
    !stringValue(content.verticalId) ||
    !stringValue(content.verticalName) ||
    !stringValue(content.area) ||
    content.area.length > 300
  ) {
    return null;
  }
  if (
    !Array.isArray(content.pickedTags) ||
    content.pickedTags.length > 20 ||
    !content.pickedTags.every((tag) => stringValue(tag) && tag.length <= 60)
  ) {
    return null;
  }
  if (content.query !== null && !stringValue(content.query)) return null;
  if (stringValue(content.query) && content.query.length > 300) return null;
  if (
    !integerValue(content.target) ||
    content.target < 1 ||
    content.target > 500 ||
    !integerValue(content.found) ||
    !integerValue(content.skippedDuplicates)
  ) {
    return null;
  }
  if (
    !(
      ["running", "paused", "complete", "cancelled", "failed"] as const
    ).includes(content.status as never)
  ) {
    return null;
  }
  if (content.endNote !== null && !stringValue(content.endNote)) return null;
  if (stringValue(content.endNote) && content.endNote.length > 300) return null;
  if (
    !objectValue(content.runBy) ||
    (content.runBy.kind !== "person" && content.runBy.kind !== "agent") ||
    !stringValue(content.runBy.pubkey) ||
    !HEX64_PATTERN.test(content.runBy.pubkey)
  ) {
    return null;
  }
  if (
    !stringValue(content.createdBy) ||
    !HEX64_PATTERN.test(content.createdBy) ||
    typeof content.createdByAgent !== "boolean" ||
    !integerValue(content.createdAt) ||
    !integerValue(content.updatedAt) ||
    typeof content.archived !== "boolean" ||
    !stringValue(content.sourceActionEventId) ||
    !HEX64_PATTERN.test(content.sourceActionEventId)
  ) {
    return null;
  }
  return {
    eventId: event.id,
    dTag,
    record: content as unknown as DiscoveryCampaignHead,
  };
}

export function buildOutreachListCreateAction(input: {
  listId: string;
  name: string;
  source: { kind: "manual" | "campaign" | "agent"; campaignId?: string };
  leadIds?: string[];
  note?: string;
  defaultTemplate?: OutreachListTemplate;
}): CreateOutreachListAction {
  if (!UUID_PATTERN.test(input.listId)) {
    throw new Error("A list id must be a UUID.");
  }
  if (!validName(input.name, 80)) {
    throw new Error("A list name must be 1 to 80 characters.");
  }
  const name = input.name.trim();
  const source: OutreachListSource = {
    kind: input.source.kind,
    campaignId: input.source.campaignId?.toLowerCase() ?? null,
  };
  if (
    (source.kind === "campaign" &&
      (!source.campaignId || !UUID_PATTERN.test(source.campaignId))) ||
    (source.kind !== "campaign" && source.campaignId !== null)
  ) {
    throw new Error("The list source is invalid.");
  }
  const leadIds = [...new Set(input.leadIds ?? [])].map((id) => {
    if (!UUID_PATTERN.test(id)) throw new Error("A lead id must be a UUID.");
    return id.toLowerCase();
  });
  if (leadIds.length > MAX_OUTREACH_LIST_LEADS) {
    throw new Error("A list can contain at most 500 leads.");
  }
  if (
    input.note !== undefined &&
    (input.note.length > 500 || hasControlCharacters(input.note))
  ) {
    throw new Error("A list note can contain at most 500 characters.");
  }
  if (
    input.defaultTemplate !== undefined &&
    !validTemplate(input.defaultTemplate)
  ) {
    throw new Error("Choose a valid WhatsApp template by name.");
  }
  return {
    schemaVersion: 1,
    listId: input.listId.toLowerCase(),
    op: "create",
    name,
    source,
    ...(leadIds.length > 0 ? { leadIds } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.defaultTemplate
      ? { defaultTemplate: input.defaultTemplate }
      : {}),
  };
}

export function buildOutreachListMutation(input: {
  listId: string;
  expectedHeadEventId?: string;
  op:
    | "rename"
    | "add_members"
    | "remove_members"
    | "set_default_template"
    | "archive"
    | "unarchive";
  name?: string;
  note?: string;
  leadIds?: string[];
  defaultTemplate?: OutreachListTemplate;
}): OutreachListMutation {
  if (!UUID_PATTERN.test(input.listId)) {
    throw new Error("A list id must be a UUID.");
  }
  if (
    input.expectedHeadEventId !== undefined &&
    !HEX64_PATTERN.test(input.expectedHeadEventId)
  ) {
    throw new Error("The list version is invalid.");
  }
  const base = {
    schemaVersion: 1 as const,
    listId: input.listId.toLowerCase(),
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
  };
  if (input.op === "rename") {
    if (input.name === undefined && input.note === undefined) {
      throw new Error("Change the list name or note.");
    }
    if (input.name !== undefined && !validName(input.name, 80)) {
      throw new Error("A list name must be 1 to 80 characters.");
    }
    if (
      input.note !== undefined &&
      (input.note.length > 500 || hasControlCharacters(input.note))
    ) {
      throw new Error("A list note can contain at most 500 characters.");
    }
    return {
      ...base,
      op: "rename",
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
  }
  if (input.op === "add_members" || input.op === "remove_members") {
    const leadIds = [...new Set(input.leadIds ?? [])].map((id) => {
      if (!UUID_PATTERN.test(id)) throw new Error("A lead id must be a UUID.");
      return id.toLowerCase();
    });
    if (leadIds.length < 1 || leadIds.length > MAX_OUTREACH_LIST_LEADS) {
      throw new Error("Choose between 1 and 500 leads.");
    }
    return { ...base, op: input.op, leadIds };
  }
  if (input.op === "set_default_template") {
    if (
      input.defaultTemplate !== undefined &&
      !validTemplate(input.defaultTemplate)
    ) {
      throw new Error("Choose a valid WhatsApp template by name.");
    }
    return {
      ...base,
      op: "set_default_template",
      ...(input.defaultTemplate
        ? { defaultTemplate: input.defaultTemplate }
        : {}),
    };
  }
  return { ...base, op: input.op };
}

export function buildDiscoveryCampaignCreateAction(input: {
  campaignId: string;
  name: string;
  audience: "businesses" | "people";
  industryName: string;
  verticalId: string;
  verticalName: string;
  pickedTags?: string[];
  query?: string;
  area: string;
  target: number;
  found?: number;
  skippedDuplicates?: number;
  status: DiscoveryCampaignHead["status"];
  endNote?: string;
  runBy?: DiscoveryCampaignHead["runBy"];
}): Extract<DiscoveryCampaignAction, { op: "create" }> {
  if (!UUID_PATTERN.test(input.campaignId)) {
    throw new Error("A campaign id must be a UUID.");
  }
  if (!validName(input.name, 120)) {
    throw new Error("A campaign name must be 1 to 120 characters.");
  }
  if (!input.area.trim() || input.area.length > 300) {
    throw new Error("A campaign area must be 1 to 300 characters.");
  }
  if (
    !Number.isInteger(input.target) ||
    input.target < 1 ||
    input.target > 500
  ) {
    throw new Error("A campaign target must be between 1 and 500.");
  }
  const pickedTags = [...new Set(input.pickedTags ?? [])]
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (pickedTags.length > 20 || pickedTags.some((tag) => tag.length > 60)) {
    throw new Error("A campaign can have at most 20 tags of 60 characters.");
  }
  if (input.query !== undefined && input.query.length > 300) {
    throw new Error("A campaign search can contain at most 300 characters.");
  }
  if (input.endNote !== undefined && input.endNote.length > 300) {
    throw new Error("A campaign note can contain at most 300 characters.");
  }
  return {
    schemaVersion: 1,
    campaignId: input.campaignId.toLowerCase(),
    op: "create",
    name: input.name.trim(),
    audience: input.audience,
    industryName: input.industryName,
    verticalId: input.verticalId,
    verticalName: input.verticalName,
    ...(pickedTags.length ? { pickedTags } : {}),
    ...(input.query ? { query: input.query } : {}),
    area: input.area.trim(),
    target: input.target,
    ...(input.found === undefined ? {} : { found: input.found }),
    ...(input.skippedDuplicates === undefined
      ? {}
      : { skippedDuplicates: input.skippedDuplicates }),
    status: input.status,
    ...(input.endNote ? { endNote: input.endNote } : {}),
    ...(input.runBy ? { runBy: input.runBy } : {}),
  };
}

export function buildDiscoveryCampaignMutation(input: {
  campaignId: string;
  expectedHeadEventId?: string;
  op: DiscoveryCampaignMutation["op"];
  name?: string;
  found?: number;
  skippedDuplicates?: number;
  status?: DiscoveryCampaignHead["status"];
  endNote?: string;
}): DiscoveryCampaignMutation {
  if (!UUID_PATTERN.test(input.campaignId)) {
    throw new Error("A campaign id must be a UUID.");
  }
  if (
    input.expectedHeadEventId !== undefined &&
    !HEX64_PATTERN.test(input.expectedHeadEventId)
  ) {
    throw new Error("The campaign version is invalid.");
  }
  const base = {
    schemaVersion: 1 as const,
    campaignId: input.campaignId.toLowerCase(),
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
  };
  if (input.op === "progress") {
    if (!integerValue(input.found) || !integerValue(input.skippedDuplicates)) {
      throw new Error("Campaign progress must use non-negative whole numbers.");
    }
    if (
      input.status !== undefined &&
      input.status !== "running" &&
      input.status !== "paused"
    ) {
      throw new Error("Campaign progress can only be running or paused.");
    }
    return {
      ...base,
      op: "progress",
      found: input.found,
      skippedDuplicates: input.skippedDuplicates,
      ...(input.status ? { status: input.status } : {}),
    };
  }
  if (input.op === "finish") {
    if (
      !integerValue(input.found) ||
      !integerValue(input.skippedDuplicates) ||
      !input.status ||
      !["complete", "cancelled", "failed"].includes(input.status)
    ) {
      throw new Error(
        "A finished campaign needs a terminal status and progress.",
      );
    }
    if (input.endNote !== undefined && input.endNote.length > 300) {
      throw new Error("A campaign note can contain at most 300 characters.");
    }
    return {
      ...base,
      op: "finish",
      found: input.found,
      skippedDuplicates: input.skippedDuplicates,
      status: input.status as "complete" | "cancelled" | "failed",
      ...(input.endNote ? { endNote: input.endNote } : {}),
    };
  }
  if (input.op === "rename") {
    if (!validName(input.name, 120)) {
      throw new Error("A campaign name must be 1 to 120 characters.");
    }
    return { ...base, op: "rename", name: input.name.trim() };
  }
  return { ...base, op: "archive" };
}
