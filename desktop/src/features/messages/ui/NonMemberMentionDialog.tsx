import * as React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { PlusIcon } from "@/shared/ui/colonyIcons";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { PRIVATE_CHANNEL_ADD_DENIED_MESSAGE } from "@/features/channels/lib/channelMemberAdmission";

type NonMemberMentionDialogProps = {
  /** False in a private channel the viewer doesn't own/administer. */
  canInvite: boolean;
  error: string | null;
  isInvitePending: boolean;
  recipients: Array<{
    avatarUrl: string | null;
    isAgent: boolean;
    label: string;
    pubkey: string;
  }>;
  onDismiss: () => void;
  /** Omit when publication requires the intended recipients to be invited. */
  onDoNothing?: () => void;
  onInvite: () => void;
  open: boolean;
  /** Restore the initiating editor when it still owns the visible draft. */
  onRestoreFocus?: () => void;
};

export function NonMemberMentionDialog({
  canInvite,
  error,
  isInvitePending,
  recipients,
  onDismiss,
  onDoNothing,
  onInvite,
  open,
  onRestoreFocus,
}: NonMemberMentionDialogProps) {
  const safeActionRef = React.useRef<HTMLButtonElement>(null);
  const restoreFocusRef = React.useRef(onRestoreFocus);
  const names = recipients.map((recipient) => recipient.label);
  const firstRecipient = recipients[0];
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onDismiss();
        }
      }}
      open={open}
    >
      <AlertDialogContent
        className="max-w-[400px] gap-4.5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusRef.current = onRestoreFocus;
          safeActionRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef.current) return;
          event.preventDefault();
          // Pending state/inert is released by the async cancellation continuation.
          // Wait for its React commit; the source checks that it is still visible.
          requestAnimationFrame(() => restoreFocusRef.current?.());
        }}
      >
        <span aria-hidden="true" className="flex items-center">
          {firstRecipient ? (
            <ProfileAvatar
              avatarUrl={firstRecipient.avatarUrl}
              className="size-10 ring-[3px] ring-colony-pop"
              label={firstRecipient.label}
              pubkey={firstRecipient.pubkey}
              shape={firstRecipient.isAgent ? "squircle" : "circle"}
            />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-full bg-colony-person text-xs font-extrabold text-colony-fg ring-[3px] ring-colony-pop" />
          )}
          <span className="-ml-2.5 flex size-10 items-center justify-center rounded-full bg-colony-track text-colony-fg-secondary ring-[3px] ring-colony-pop">
            <PlusIcon size={17} strokeWidth={2} />
          </span>
        </span>
        <AlertDialogHeader>
          <AlertDialogTitle className="leading-[1.2]">
            Mention people outside this channel?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-[1.55]">
            {names.join(", ")} {names.length === 1 ? "is" : "are"} not in this
            channel.{" "}
            {onDoNothing
              ? canInvite
                ? "Invite them to the channel, or send without inviting them."
                : `${PRIVATE_CHANNEL_ADD_DENIED_MESSAGE} You can still send without inviting them.`
              : canInvite
                ? "Invite them to the channel, or cancel to keep your draft."
                : PRIVATE_CHANNEL_ADD_DENIED_MESSAGE}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p
            role="alert"
            className="rounded-colony-control-lg bg-colony-danger-bg px-3 py-2 text-xs font-semibold text-colony-danger"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter className="flex-row flex-wrap justify-end pt-0">
          {/* "Do nothing" keeps the draft and closes; "Send anyway" sends it
              without inviting the people who are not in the channel. */}
          <Button
            className="px-4"
            disabled={Boolean(onDoNothing) && isInvitePending}
            onClick={onDismiss}
            ref={safeActionRef}
            size="dialog"
            type="button"
            variant="ghost"
          >
            {onDoNothing ? "Do nothing" : "Cancel"}
          </Button>
          {onDoNothing ? (
            <Button
              className="px-4"
              disabled={isInvitePending}
              onClick={onDoNothing}
              size="dialog"
              type="button"
              variant="outline"
            >
              Send anyway
            </Button>
          ) : null}
          {canInvite ? (
            <Button
              disabled={isInvitePending}
              onClick={onInvite}
              size="dialog"
              type="button"
            >
              {isInvitePending ? "Inviting..." : "Invite"}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
