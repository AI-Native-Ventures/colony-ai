import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";

import {
  type PinnableMessage,
  useChannelPinsQuery,
  usePinMessageMutation,
  useUnpinMessageMutation,
} from "../hooks";
import { pinEventsBy } from "../pinModels";

/**
 * Pin and Unpin in a message's More menu. It mounts only while the menu is open,
 * so a channel's pins are read when someone first opens a menu, not once per
 * message. Until they have loaded the item is disabled, so a message cannot be
 * pinned twice by acting on a guess.
 *
 * Three states: not pinned (Pin to channel), pinned by you (Unpin from channel),
 * pinned by someone else (disabled "Pinned by <name>", since only the pinner can
 * delete a pin).
 */
export function MessagePinMenuItem({
  channelId,
  message,
}: {
  channelId: string;
  message: PinnableMessage;
}) {
  const pinsQuery = useChannelPinsQuery(channelId);
  const pin = usePinMessageMutation(channelId);
  const unpin = useUnpinMessageMutation(channelId);
  const identityQuery = useIdentityQuery();
  const me = identityQuery.data?.pubkey;

  const pinned = pinsQuery.data?.pins.find(
    (candidate) => candidate.targetId === message.id.toLowerCase(),
  );
  const mine = pinEventsBy(pinned, me);
  // An optimistic pin has no event to delete yet; wait for the relay's answer.
  const confirming = mine.some((record) =>
    record.pinEventId.startsWith("pending:"),
  );
  const otherPinner = pinned && mine.length === 0 ? pinned.pinnedBy : null;
  const profilesQuery = useUsersBatchQuery(otherPinner ? [otherPinner] : []);
  const ready = pinsQuery.isSuccess && Boolean(me);
  const testId = `pin-message-${message.id}`;

  if (pinned && mine.length === 0) {
    const name = resolveUserLabel({
      currentPubkey: me,
      profiles: profilesQuery.data?.profiles,
      pubkey: pinned.pinnedBy,
      preferResolvedSelfLabel: true,
    });
    return (
      <DropdownMenuItem
        aria-label={`Pinned by ${name}. Only they can unpin it.`}
        data-testid={testId}
        disabled
      >
        <Pin aria-hidden="true" className="h-4 w-4" />
        Pinned by {name}
      </DropdownMenuItem>
    );
  }

  if (pinned) {
    return (
      <DropdownMenuItem
        aria-label="Unpin from channel"
        data-testid={testId}
        disabled={unpin.isPending || confirming}
        onSelect={() =>
          unpin.mutate(
            {
              targetId: pinned.targetId,
              pinEventIds: mine.map((record) => record.pinEventId),
            },
            {
              onSuccess: () => toast.success("Unpinned"),
              onError: (error) => {
                console.warn("[pins] unpin failed", error);
                toast.error("Couldn't unpin the message. Try again.");
              },
            },
          )
        }
      >
        <PinOff aria-hidden="true" className="h-4 w-4" />
        Unpin from channel
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      aria-label="Pin to channel"
      data-testid={testId}
      disabled={!ready || pin.isPending}
      onSelect={() => {
        if (!me) return;
        pin.mutate(
          { message, pinnedBy: me },
          {
            onSuccess: () => toast.success("Pinned to the channel"),
            onError: (error) => {
              console.warn("[pins] pin failed", error);
              toast.error("Couldn't pin the message. Try again.");
            },
          },
        );
      }}
    >
      <Pin aria-hidden="true" className="h-4 w-4" />
      Pin to channel
    </DropdownMenuItem>
  );
}
