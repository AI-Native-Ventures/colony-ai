import { toast } from "sonner";

import { useRemoveRelayMemberMutation } from "@/features/community-members/hooks";
import type { RelayMember } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import { PubKey } from "@/shared/ui/PubKey";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import "@/features/company-team/ui/TeamDialogs.css";

export function ConfirmRemoveDialog({
  member,
  displayName,
  open,
  onOpenChange,
  onRemoved,
}: {
  member: RelayMember | null;
  displayName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void | Promise<void>;
}) {
  const removeMutation = useRemoveRelayMemberMutation();
  const label = displayName || (member ? truncateNpub(member.pubkey) : "");

  function handleOpenChange(next: boolean) {
    if (!next) {
      removeMutation.reset();
    }
    onOpenChange(next);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="team-dialog"
        data-testid="confirm-remove-member-dialog"
        showCloseButton={false}
      >
        <div className="team-dialog-form">
          <div className="team-dialog-head">
            <div className="team-dialog-heading">
              <DialogTitle className="team-dialog-title">
                Remove {label}?
              </DialogTitle>
              <DialogDescription className="team-dialog-subtitle">
                This will immediately revoke their access to the relay and this
                company.
              </DialogDescription>
            </div>
            <DialogClose className="team-dialog-close" type="button">
              <CloseIcon size={16} strokeWidth={2.4} />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          {member ? (
            <PubKey
              pubkey={member.pubkey}
              testId="confirm-remove-member-pubkey"
              variant="full"
            />
          ) : null}
          <div className="team-dialog-warning">
            <span>
              {label || "This person"} can no longer access the company after
              you remove them.
            </span>
          </div>
          <div className="team-dialog-actions">
            <button
              className="team-dialog-button"
              onClick={() => handleOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="team-dialog-button"
              data-variant="danger"
              data-testid="confirm-remove-member"
              disabled={removeMutation.isPending || !member}
              onClick={() => {
                if (!member) return;
                removeMutation.mutate(member.pubkey, {
                  onSuccess: async () => {
                    toast.success("Member removed");
                    await onRemoved?.();
                    handleOpenChange(false);
                  },
                  onError: (error) => {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to remove member",
                    );
                  },
                });
              }}
              type="button"
            >
              {removeMutation.isPending ? "Removing..." : "Remove"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
