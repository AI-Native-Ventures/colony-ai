import { useChannelMembersQuery } from "@/features/channels/hooks";
import { ChannelCanvas } from "@/features/channels/ui/ChannelCanvas";
import { useChannelModerationCapabilities } from "@/features/channels/ui/ChannelManagementModerationActions";

import { useWorkAreaChannel } from "../workAreaChannelContext";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";

/**
 * The channel's Markdown canvas, hosted in the dock: preview, edit, save. The
 * same component, query and mutation as the channel settings view, with the
 * same edit rule (a channel manager who is a member, never in a DM). An edit
 * in progress survives closing the dock.
 */
export function WorkAreaCanvasTab({ channelId }: WorkAreaTabPanelProps) {
  const channel = useWorkAreaChannel();
  const members = useChannelMembersQuery(channelId);
  const { canManageChannel } = useChannelModerationCapabilities(
    members.data,
    channel?.currentPubkey,
    true,
  );
  const isMember =
    members.data?.some(
      (member) =>
        member.pubkey.toLowerCase() === channel?.currentPubkey?.toLowerCase(),
    ) ?? false;
  const canEdit = canManageChannel && isMember && channel?.channelType !== "dm";
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-4"
      data-testid="work-area-canvas"
    >
      <ChannelCanvas
        canEdit={canEdit}
        channelId={channelId}
        isArchived={channel?.isArchived ?? false}
        keepEditsKey={channelId}
      />
    </div>
  );
}
