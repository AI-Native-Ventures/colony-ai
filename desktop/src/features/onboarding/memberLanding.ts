import type { Channel } from "@/shared/api/types";

/**
 * Where a person who just joined a workspace by invite lands: the shared
 * `general` channel, else the first open channel they can read. Never a
 * channel created for a business setup they do not own.
 */
export function pickMemberLandingChannel(
  channels: ReadonlyArray<
    Pick<Channel, "id" | "name" | "channelType" | "visibility" | "archivedAt">
  >,
): string | null {
  const live = channels.filter(
    (channel) => !channel.archivedAt && channel.channelType === "stream",
  );
  const general = live.find(
    (channel) => channel.name.trim().toLowerCase() === "general",
  );
  if (general) return general.id;
  const open = live.find((channel) => channel.visibility === "open");
  return (open ?? live[0])?.id ?? null;
}
