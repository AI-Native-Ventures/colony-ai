import * as React from "react";

import type { AddCommunityPrefillRequest } from "@/features/communities/addCommunityPrefill";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { AddCommunityPanel } from "./AddCommunityPanel";

type AddCommunityDialogProps = {
  prefill?: AddCommunityPrefillRequest | null;
  onSubmit?: (
    community: import("@/features/communities/types").Community,
  ) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddCommunityDialog({
  prefill,
  open,
  onOpenChange,
}: AddCommunityDialogProps) {
  const communityOnboarding = useCommunityOnboarding();
  const [joinError, setJoinError] = React.useState<string | null>(null);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    setJoinError(null);
  }, [onOpenChange]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
        else onOpenChange(true);
      }}
      open={open}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[940px] gap-0 overflow-hidden rounded-[1.625rem] p-0"
        data-testid="add-community-dialog"
        showCloseButton={false}
        surface="none"
      >
        <DialogTitle className="sr-only">Add a community</DialogTitle>
        <DialogDescription className="sr-only">
          Create a new community or join one you already have.
        </DialogDescription>
        <AddCommunityPanel
          joinError={joinError}
          onClose={handleClose}
          onStart={({ relayUrl, inviteCode, policyReceipt }) => {
            const started = communityOnboarding.start({
              source: "add-community",
              relayUrl,
              inviteCode,
              communityName: prefill?.name,
              policyReceipt,
            });
            if (!started) {
              setJoinError(
                "Finish connecting the community already in progress, then try again.",
              );
              return;
            }
            handleClose();
          }}
          prefill={prefill}
          titleId="add-community-dialog-title"
        />
      </DialogContent>
    </Dialog>
  );
}
