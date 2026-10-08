import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { plainRelayErrorMessage } from "@/shared/lib/relayError";
import { Button } from "@/shared/ui/button";

import { useChannelPinsQuery, useUnpinMessageMutation } from "../hooks";
import { type ChannelPin, pinEventsBy, pinPreview } from "../pinModels";

const TEST_ID = "pinned-messages";

function formatPinned(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
    : "";
}

/**
 * A channel's pinned messages, one list for every place that shows them (the
 * Knowledge tab and the Pins screen). Loading, failed and empty are plain,
 * failed offers Retry, and each row opens the message in its channel. A pin the
 * viewer made has an Unpin button; a pin someone else made does not, because
 * only its author can delete it.
 */
export function PinnedMessagesList({
  channelId,
  empty,
}: {
  channelId: string;
  /** Replaces the default empty text (the Pins screen keeps its own scene). */
  empty?: React.ReactNode;
}) {
  const query = useChannelPinsQuery(channelId);
  const unpin = useUnpinMessageMutation(channelId);
  const { goChannel } = useAppNavigation();
  const identityQuery = useIdentityQuery();
  const me = identityQuery.data?.pubkey;
  const pins = query.data?.pins ?? [];

  const people = React.useMemo(
    () => [
      ...new Set(
        pins.flatMap((pin) => [
          pin.pinnedBy,
          ...(pin.target.state === "message" ? [pin.target.author] : []),
        ]),
      ),
    ],
    [pins],
  );
  const profilesQuery = useUsersBatchQuery(people);
  const profiles = profilesQuery.data?.profiles;
  const label = (pubkey: string) =>
    resolveUserLabel({
      currentPubkey: me,
      profiles,
      pubkey,
      preferResolvedSelfLabel: true,
    });

  const failedError = query.isError ? query.error : null;
  React.useEffect(() => {
    // The raw text belongs in the log, never on screen.
    if (failedError !== null) {
      console.warn(
        "[pins] pinned messages could not be loaded",
        failedError instanceof Error
          ? failedError.message
          : String(failedError),
      );
    }
  }, [failedError]);

  const onUnpin = (pin: ChannelPin) => {
    unpin.mutate(
      {
        targetId: pin.targetId,
        pinEventIds: pinEventsBy(pin, me).map((record) => record.pinEventId),
      },
      {
        onSuccess: () => toast.success("Unpinned"),
        onError: (error) => {
          console.warn("[pins] unpin failed", error);
          toast.error("Couldn't unpin the message. Try again.");
        },
      },
    );
  };

  if (query.isPending) {
    return (
      <p
        className="px-3 py-3 text-xs text-muted-foreground"
        data-state="loading"
        data-testid={`${TEST_ID}-state`}
        role="status"
      >
        Loading pinned messages
      </p>
    );
  }
  if (query.isError && !query.data) {
    return (
      <div
        className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-muted-foreground"
        data-state="failed"
        data-testid={`${TEST_ID}-state`}
        role="alert"
      >
        <span>
          Pinned messages could not be loaded.{" "}
          {plainRelayErrorMessage(query.error)}
        </span>
        <Button
          className="h-7 px-2 text-xs"
          data-testid={`${TEST_ID}-state-retry`}
          onClick={() => void query.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }
  if (pins.length === 0) {
    return (
      empty ?? (
        <p
          className="px-3 py-3 text-xs text-muted-foreground"
          data-state="empty"
          data-testid={`${TEST_ID}-state`}
        >
          No pinned messages yet. Pin a message from its menu so the team can
          find it.
        </p>
      )
    );
  }

  return (
    <div data-testid={TEST_ID}>
      {query.isError ? (
        <div
          className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground"
          data-testid={`${TEST_ID}-stale`}
          role="status"
        >
          <span>Pinned messages could not be refreshed.</span>
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => void query.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      <ul aria-label="Pinned messages">
        {pins.map((pin) => {
          const mine = pinEventsBy(pin, me).length > 0;
          const pending = pin.pins.some((record) =>
            record.pinEventId.startsWith("pending:"),
          );
          const target = pin.target;
          const pinnedLine = `Pinned by ${label(pin.pinnedBy)}${
            pin.pinnedAt ? ` · ${formatPinned(pin.pinnedAt)}` : ""
          }`;
          return (
            <li
              className="flex items-stretch border-b border-border"
              data-testid={`${TEST_ID}-row-${pin.targetId}`}
              key={pin.targetId}
            >
              {target.state === "message" ? (
                <button
                  aria-label={`Open pinned message from ${label(target.author)}`}
                  className="min-w-0 flex-1 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`${TEST_ID}-open-${pin.targetId}`}
                  onClick={() =>
                    void goChannel(channelId, { messageId: pin.targetId })
                  }
                  type="button"
                >
                  <span className="block text-xs text-muted-foreground">
                    {label(target.author)}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block break-words text-sm text-foreground">
                    {pinPreview(target.content) || "Message with no text"}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {pinnedLine}
                  </span>
                </button>
              ) : (
                <div
                  className="min-w-0 flex-1 px-3 py-3"
                  data-testid={`${TEST_ID}-unavailable-${pin.targetId}`}
                >
                  <span className="block text-sm text-foreground">
                    This message is no longer available
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    It was deleted, or you can't read it. {pinnedLine}
                  </span>
                </div>
              )}
              {mine ? (
                <div className="flex shrink-0 items-center pr-3">
                  <Button
                    aria-label={`Unpin ${
                      target.state === "message"
                        ? `the message from ${label(target.author)}`
                        : "this unavailable message"
                    }`}
                    data-testid={`${TEST_ID}-unpin-${pin.targetId}`}
                    disabled={pending || unpin.isPending}
                    onClick={() => onUnpin(pin)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Unpin
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {query.data?.truncated ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Showing the most recent pins only.
        </p>
      ) : null}
    </div>
  );
}
