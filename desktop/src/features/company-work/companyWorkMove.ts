import { getThreadReference } from "@/features/messages/lib/threading";
import type { Channel, ChannelMember, RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";

export type CompanyWorkThreadRoot = {
  event: RelayEvent;
  channel: Channel;
  preview: string;
};

export function parseCompanyWorkThreadRoots(
  events: readonly RelayEvent[],
  channels: readonly Channel[],
): CompanyWorkThreadRoot[] {
  const channelsById = new Map(
    channels.map((channel) => [channel.id.toLowerCase(), channel]),
  );
  const roots = new Map<string, CompanyWorkThreadRoot>();
  for (const event of events) {
    if (
      event.kind !== KIND_STREAM_MESSAGE &&
      event.kind !== KIND_STREAM_MESSAGE_V2
    ) {
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(event.id)) continue;
    const channelTags = event.tags.filter((tag) => tag[0] === "h");
    const channelId = channelTags[0]?.[1]?.toLowerCase();
    if (channelTags.length !== 1 || !channelId) continue;
    const channel = channelsById.get(channelId);
    if (
      channel?.channelType !== "stream" ||
      !channel.isMember ||
      channel.archivedAt !== null ||
      getThreadReference(event.tags).parentId !== null
    ) {
      continue;
    }
    const preview = event.content
      .split(/\r?\n/, 1)[0]
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    roots.set(event.id.toLowerCase(), {
      event,
      channel,
      preview: preview || "Conversation thread",
    });
  }
  return [...roots.values()].sort(
    (left, right) =>
      right.event.created_at - left.event.created_at ||
      left.event.id.localeCompare(right.event.id),
  );
}

function membershipRoleKey(members: readonly ChannelMember[]) {
  return members
    .map((member) => `${member.pubkey.toLowerCase()}:${member.role}`)
    .sort();
}

export function hasSameCompanyWorkAudience(
  source: Channel,
  destination: Channel,
  sourceMembers: readonly ChannelMember[],
  destinationMembers: readonly ChannelMember[],
): boolean {
  if (
    source.visibility !== destination.visibility ||
    sourceMembers.length !== destinationMembers.length
  ) {
    return false;
  }
  const sourceRoles = membershipRoleKey(sourceMembers);
  const destinationRoles = membershipRoleKey(destinationMembers);
  return sourceRoles.every((role, index) => role === destinationRoles[index]);
}
