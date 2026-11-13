import * as React from "react";

import type { AddCommunityPrefillRequest } from "@/features/communities/addCommunityPrefill";
import { AddCommunityDialog } from "@/features/communities/ui/AddCommunityDialog";
import { CreateChannelDialog } from "@/features/sidebar/ui/CreateChannelDialog";
import type { ChannelVisibility } from "@/shared/api/types";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";

type MapShellDialogsProps = {
  addWorkspacePrefill: AddCommunityPrefillRequest | null;
  isAddWorkspaceOpen: boolean;
  isCreateChannelOpen: boolean;
  isCreatingChannel: boolean;
  onAddWorkspaceOpenChange: (open: boolean) => void;
  onCreateChannel: (input: {
    name: string;
    description?: string;
    visibility: ChannelVisibility;
    ttlSeconds?: number;
  }) => Promise<void>;
  onCreateChannelOpenChange: (open: boolean) => void;
  onOpenWorkspaceDialog: (mode: "create" | "join") => void;
  workspaceDialogMode: "add-community" | "create" | "join";
};

/**
 * Dialogs the top bar and its shortcuts open: create a channel, and create or
 * join a workspace.
 *
 * The sidebar mounts these in the old shell. It is not on screen while the map
 * shell is, so without this the actions that open them would do nothing.
 */
export function MapShellDialogs({
  addWorkspacePrefill,
  isAddWorkspaceOpen,
  isCreateChannelOpen,
  isCreatingChannel,
  onAddWorkspaceOpenChange,
  onCreateChannel,
  onCreateChannelOpenChange,
  onOpenWorkspaceDialog,
  workspaceDialogMode,
}: MapShellDialogsProps) {
  // The request comes from a menu that is still closing. Opening one frame
  // later keeps the menu from taking focus back from the dialog.
  const [isChannelDialogShown, setIsChannelDialogShown] = React.useState(false);
  const { cancelDeferredModalOpen, openNextFrame } = useDeferredModalOpen();
  React.useEffect(() => {
    if (!isCreateChannelOpen) {
      cancelDeferredModalOpen();
      setIsChannelDialogShown(false);
      return;
    }
    openNextFrame(() => setIsChannelDialogShown(true));
  }, [cancelDeferredModalOpen, isCreateChannelOpen, openNextFrame]);

  return (
    <>
      <CreateChannelDialog
        channelKind={isChannelDialogShown ? "stream" : null}
        isCreating={isCreatingChannel}
        onCreate={onCreateChannel}
        onOpenChange={(open) => {
          if (!open) onCreateChannelOpenChange(false);
        }}
      />
      <AddCommunityDialog
        mode={workspaceDialogMode}
        onOpenChange={onAddWorkspaceOpenChange}
        onOpenWorkspaceDialog={onOpenWorkspaceDialog}
        open={isAddWorkspaceOpen}
        prefill={addWorkspacePrefill}
      />
    </>
  );
}
