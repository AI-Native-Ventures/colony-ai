/**
 * The channel gate every data-backed dock tab applies before it reads anything:
 * the channel list must have loaded, and the person must belong to the channel.
 *
 * Why this is the tab's whole "denied": a person the relay refuses as a
 * community member never reaches a tab, because the shell's membership watcher
 * replaces the workspace with the community escape screen. What is left for a
 * tab is the channel gate.
 */
export type QueryProgress = {
  status: "pending" | "error" | "success";
  error: unknown;
};

export type GateChannel = {
  id: string;
  channelType: string;
  isMember: boolean;
  archivedAt: string | null;
};

export type ChannelGate =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "denied" }
  | { state: "open"; channel: GateChannel };

export function resolveChannelGate(
  channelId: string,
  channels: QueryProgress & { data: readonly GateChannel[] | undefined },
): ChannelGate {
  if (channels.status === "error") {
    return { state: "failed", error: channels.error };
  }
  if (channels.status === "pending") return { state: "loading" };
  const id = channelId.toLowerCase();
  const channel = (channels.data ?? []).find(
    (candidate) => candidate.id.toLowerCase() === id,
  );
  if (!channel?.isMember) return { state: "denied" };
  return { state: "open", channel };
}
