import * as React from "react";

import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import { useAvailableAcpRuntimes } from "@/features/agents/hooks";
import type { Channel } from "@/shared/api/types";
import { AddChannelBotDialog } from "./AddChannelBotDialog";

/**
 * Add agents, opened from the Channel members dialog ("Agent actions"). It
 * resolves the runtimes the dialog needs itself, so the members dialog only
 * decides when to open it.
 */
export function ChannelAddAgentsDialog({
  channel,
  onOpenChange,
  open,
}: {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const providersQuery = useAvailableAcpRuntimes();
  const providers = React.useMemo(
    () =>
      [...(providersQuery.data ?? [])].sort((left, right) => {
        const leftPriority = left.id === "goose" ? 0 : 1;
        const rightPriority = right.id === "goose" ? 0 : 1;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.label.localeCompare(right.label);
      }),
    [providersQuery.data],
  );

  return (
    <AddChannelBotDialog
      channelId={channel?.id ?? null}
      onCreateAgent={() => {
        if (!channel) return;
        requestOpenCreateAgent({
          channelId: channel.id,
          channelName: channel.name,
        });
      }}
      onOpenChange={onOpenChange}
      open={open}
      providers={providers}
      providersErrorMessage={
        providersQuery.error instanceof Error
          ? providersQuery.error.message
          : null
      }
      providersLoading={providersQuery.isLoading}
    />
  );
}
