import { ChannelMemberInviteCard } from "@/features/channels/ui/ChannelMemberInviteCard";
import type {
  AddChannelMembersResult,
  ChannelMember,
} from "@/shared/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

import { AskInfoIcon } from "./askIcons";

/** "Invite someone": add a teammate to the channel so they can be chosen. */
export function AskInviteDialog({
  open,
  onOpenChange,
  canAssignElevatedRoles,
  existingMembers,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAssignElevatedRoles: boolean;
  existingMembers: ChannelMember[];
  isPending: boolean;
  onSubmit: (input: {
    pubkeys: string[];
    role: Exclude<ChannelMember["role"], "owner">;
  }) => Promise<AddChannelMembersResult>;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby="ask-invite-description"
        className="ask3-invite"
        closeButtonClassName="ask3-invite-close"
        surface="none"
      >
        <DialogTitle className="ask3-invite-title">Invite someone</DialogTitle>
        <DialogDescription
          className="ask3-invite-desc"
          id="ask-invite-description"
        >
          Add a person to this conversation so they can be chosen as the
          recipient. Their access stays limited to this channel.
        </DialogDescription>
        <ChannelMemberInviteCard
          canAssignElevatedRoles={canAssignElevatedRoles}
          existingMembers={existingMembers}
          footerNote={
            <p className="ask3-invite-note">
              <AskInfoIcon size={16} />
              An invitation does not make the person eligible to approve money,
              hires or tools.
            </p>
          }
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
          open={open}
          requestErrorMessage={null}
        />
      </DialogContent>
    </Dialog>
  );
}
