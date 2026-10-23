import type { Channel } from "@/shared/api/types";

/** The office header's small label naming what kind of conversation is open. */
export function getChannelKicker(
  channel: Pick<Channel, "channelType" | "visibility"> | null,
): string | undefined {
  if (!channel) return undefined;
  if (channel.channelType === "dm") return "Direct message";
  const isPrivate = channel.visibility === "private";
  if (channel.channelType === "forum") {
    return isPrivate ? "Private forum" : "Forum";
  }
  return isPrivate ? "Private channel" : "Channel";
}
