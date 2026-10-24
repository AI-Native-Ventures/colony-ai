import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useCompanyTeamQuery } from "../teamRelay";
import {
  EditRoleReportingDialog,
  ReviewRehireDialog,
  TerminateEmployeeDialog,
} from "./TeamDialogs";
import { TeamMemberScreen } from "./TeamMemberScreen";
import "./TeamDialogs.css";

export type TeamMemberDialogKind = "edit" | "terminate" | "rehire";

/**
 * A person's page with one of the Team dialogs open over it. The old
 * `/team/edit` and `/team/archive` URLs land here, so a link or bookmark to
 * them still opens the same dialog.
 */
export function TeamMemberDialogRoute({
  dialog,
  memberPubkey,
}: {
  dialog: TeamMemberDialogKind;
  memberPubkey: string;
}) {
  const { goTeamMember } = useAppNavigation();
  const teamQuery = useCompanyTeamQuery();
  const identity = useIdentityQuery();
  const member = teamQuery.data?.members.find(
    (candidate) => candidate.pubkey === memberPubkey.toLowerCase(),
  );
  const role = teamQuery.data?.relayMembers.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === identity.data?.pubkey.toLowerCase(),
  )?.role;
  const canManage = role === "owner" || role === "admin";
  const isSelf =
    identity.data?.pubkey.toLowerCase() === memberPubkey.toLowerCase();
  const onOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) void goTeamMember(memberPubkey, { replace: true });
    },
    [goTeamMember, memberPubkey],
  );
  const allowed =
    canManage || (dialog === "edit" && isSelf && member?.kind === "human");

  return (
    <>
      <TeamMemberScreen memberPubkey={memberPubkey} mode="detail" />
      {member && allowed ? (
        dialog === "edit" ? (
          <EditRoleReportingDialog
            member={member}
            onOpenChange={onOpenChange}
            open
          />
        ) : member.kind !== "employee" ? null : dialog === "terminate" ? (
          <TerminateEmployeeDialog
            member={member}
            onOpenChange={onOpenChange}
            open
          />
        ) : (
          <ReviewRehireDialog
            member={member}
            onOpenChange={onOpenChange}
            open
          />
        )
      ) : member && teamQuery.data ? (
        <Dialog onOpenChange={onOpenChange} open>
          <DialogContent className="team-dialog" showCloseButton={false}>
            <div className="team-dialog-form" role="alert">
              <DialogTitle className="team-dialog-title">
                This change needs an owner or admin
              </DialogTitle>
              <DialogDescription className="team-dialog-subtitle">
                Only a community owner or admin can make this change directly.
              </DialogDescription>
              <div className="team-dialog-actions">
                <button
                  className="team-dialog-button"
                  onClick={() => onOpenChange(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
