import * as React from "react";

import {
  useAvailableAcpRuntimes,
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import type { Channel } from "@/shared/api/types";

import { AddChannelBotDialog } from "./AddChannelBotDialog";

/**
 * Hosts the Add agents dialog for the channel on screen. The header's members
 * control and the empty-channel card both open it through the screen's
 * `isAddBotOpen` state, so the dialog lives next to the header, not inside it.
 */
export function ChannelAddAgentHost({
  channel,
  onOpenChange,
  open,
}: {
  channel: Channel;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (open === undefined) setUncontrolledOpen(next);
    },
    [onOpenChange, open],
  );
  const providersQuery = useAvailableAcpRuntimes();
  const managedAgentsQuery = useManagedAgentsQuery();
  const relayAgentsQuery = useRelayAgentsQuery();
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
  const previousChannelIdRef = React.useRef(channel.id);
  React.useEffect(() => {
    if (previousChannelIdRef.current === channel.id) return;
    previousChannelIdRef.current = channel.id;
    setIsOpen(false);
  }, [channel.id, setIsOpen]);

  const errorMessage =
    providersQuery.error instanceof Error
      ? providersQuery.error.message
      : managedAgentsQuery.error instanceof Error
        ? managedAgentsQuery.error.message
        : relayAgentsQuery.error instanceof Error
          ? relayAgentsQuery.error.message
          : null;

  return (
    <AddChannelBotDialog
      channelId={channel.id}
      onCreateAgent={() => {
        requestOpenCreateAgent({
          channelId: channel.id,
          channelName: channel.name,
        });
      }}
      onOpenChange={setIsOpen}
      open={isOpen}
      providers={providers}
      providersErrorMessage={errorMessage}
      providersLoading={providersQuery.isLoading}
    />
  );
}
