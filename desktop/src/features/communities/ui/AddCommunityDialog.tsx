import * as React from "react";

import type { AddCommunityPrefillRequest } from "@/features/communities/addCommunityPrefill";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { InviteRedeemForm } from "@/features/onboarding/ui/InviteRedeemForm";
import { CloseXIcon, LinkIcon } from "@/features/onboarding/ui/firstRunIcons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { AddCommunityPanel } from "./AddCommunityPanel";
import { SelfServeCommunityCreateFlow } from "./SelfServeCommunityCreateFlow";

type AddCommunityDialogProps = {
  mode?: "add-community" | "create" | "join";
  prefill?: AddCommunityPrefillRequest | null;
  onOpenWorkspaceDialog?: (mode: "create" | "join") => void;
  onSubmit?: (
    community: import("@/features/communities/types").Community,
  ) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddCommunityDialog({
  mode = "add-community",
  prefill,
  onOpenWorkspaceDialog,
  open,
  onOpenChange,
}: AddCommunityDialogProps) {
  const communityOnboarding = useCommunityOnboarding();
  const [joinError, setJoinError] = React.useState<string | null>(null);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    setJoinError(null);
  }, [onOpenChange]);

  const handleWorkspaceStart = React.useCallback(
    (relayUrl: string, inviteCode?: string, policyReceipt?: string) => {
      const started = communityOnboarding.start({
        source: "add-community",
        relayUrl,
        inviteCode,
        communityName: prefill?.name,
        policyReceipt,
      });
      if (!started) {
        setJoinError(
          "Finish connecting the workspace already in progress, then try again.",
        );
        return;
      }
      handleClose();
    },
    [communityOnboarding, handleClose, prefill?.name],
  );

  const isWorkspaceAction = mode === "create" || mode === "join";

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
        aria-labelledby={
          isWorkspaceAction
            ? mode === "create"
              ? "self-serve-community-title"
              : "workspace-join-title"
            : undefined
        }
        className={
          isWorkspaceAction
            ? "c3fr-dialog max-h-[90vh] max-w-[40rem] gap-0 overflow-y-auto rounded-[1.625rem] border border-border bg-background p-0 shadow-2xl"
            : "max-w-[940px] gap-0 overflow-hidden rounded-[1.625rem] p-0"
        }
        data-testid={
          isWorkspaceAction ? "workspace-action-dialog" : "add-community-dialog"
        }
        showCloseButton={false}
        surface="none"
      >
        <DialogDescription className="sr-only">
          {isWorkspaceAction
            ? mode === "create"
              ? "Create a workspace for another business."
              : "Join a workspace using an invite link."
            : "Create a new community or join one you already have."}
        </DialogDescription>
        {isWorkspaceAction ? (
          <div className="relative">
            <button
              aria-label="Close workspace dialog"
              className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="workspace-dialog-close"
              onClick={handleClose}
              type="button"
            >
              <CloseXIcon size={18} />
            </button>
            {mode === "create" ? (
              <SelfServeCommunityCreateFlow
                onBack={handleClose}
                onComplete={handleClose}
                onJoin={() => onOpenWorkspaceDialog?.("join")}
                variant="workspace"
              />
            ) : (
              <section
                aria-labelledby="workspace-join-title"
                className="c3fr-pane gap-0"
                data-testid="workspace-join-form"
              >
                <div className="c3fr-pane-head mb-5">
                  <span aria-hidden="true" className="c3fr-tile">
                    <LinkIcon size={20} />
                  </span>
                  <div className="c3fr-pane-head-text">
                    <h2 className="c3fr-pane-title" id="workspace-join-title">
                      Join a workspace
                    </h2>
                    <span className="c3fr-pane-desc">
                      Use an invite link someone sent you.
                    </span>
                  </div>
                </div>
                <InviteRedeemForm
                  error={joinError}
                  initialValue={prefill?.relayUrl}
                  isRedeeming={false}
                  key={prefill?.requestId ?? "workspace-join"}
                  onCancel={handleClose}
                  onConnect={(relayUrl) => handleWorkspaceStart(relayUrl)}
                  onRedeem={(relayUrl, inviteCode, policyReceipt) =>
                    handleWorkspaceStart(relayUrl, inviteCode, policyReceipt)
                  }
                  variant="add-workspace"
                />
              </section>
            )}
          </div>
        ) : (
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
            titleAs={DialogTitle}
            titleId="add-community-dialog-title"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
