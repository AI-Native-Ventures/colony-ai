import * as React from "react";
import { toast } from "sonner";

import { useChangeRelayMemberRoleMutation } from "@/features/community-members/hooks";
import type { RelayMember } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import "@/features/company-team/ui/TeamDialogs.css";

type AccessRole = "admin" | "member";

function roleActionLabel(role: AccessRole) {
  return role === "admin" ? "Make admin" : "Make member";
}

export function ConfirmMemberRoleDialog({
  displayName,
  initialRole,
  member,
  onOpenChange,
  open,
}: {
  displayName: string | null;
  initialRole?: AccessRole;
  member: RelayMember | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { isPending, mutateAsync, reset } = useChangeRelayMemberRoleMutation();
  const currentRole: AccessRole = member?.role === "admin" ? "admin" : "member";
  const [nextRole, setNextRole] = React.useState<AccessRole>(
    initialRole ?? currentRole,
  );
  const label = displayName || (member ? truncateNpub(member.pubkey) : "");

  React.useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setNextRole(initialRole ?? currentRole);
  }, [currentRole, initialRole, open, reset]);

  const action = roleActionLabel(nextRole);
  const roleExplanation =
    nextRole === "admin"
      ? "Admins can manage people and access for this company."
      : "Members cannot manage people and access for this company.";

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member || nextRole === member.role) return;
    try {
      await mutateAsync({ pubkey: member.pubkey, role: nextRole });
      toast.success(
        nextRole === "admin" ? "Made community admin" : "Made community member",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change access role",
      );
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="team-dialog"
        data-testid="confirm-member-role-dialog"
        showCloseButton={false}
      >
        <form
          className="team-dialog-form"
          onSubmit={(event) => void confirm(event)}
        >
          <div className="team-dialog-head">
            <div className="team-dialog-heading">
              <DialogTitle className="team-dialog-title">
                Change access role
              </DialogTitle>
              <DialogDescription className="team-dialog-subtitle">
                {label || "This person"} · Current role: {currentRole}
              </DialogDescription>
            </div>
            <DialogClose className="team-dialog-close" type="button">
              <CloseIcon size={16} strokeWidth={2.4} />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <label className="team-dialog-field" htmlFor="member-access-role">
            Access role
            <select
              className="team-dialog-input team-dialog-select"
              id="member-access-role"
              onChange={(event) =>
                setNextRole(event.target.value as AccessRole)
              }
              value={nextRole}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <p className="team-dialog-note">
            {roleExplanation} This does not change job title or reporting line.
          </p>
          <div className="team-dialog-actions">
            <button
              className="team-dialog-button"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="team-dialog-button"
              data-variant="primary"
              disabled={!member || nextRole === currentRole || isPending}
              type="submit"
            >
              {isPending ? "Saving" : action}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
