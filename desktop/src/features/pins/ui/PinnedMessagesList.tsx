import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useJobTitleLookup } from "@/features/company-team/useJobTitleLookup";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useIdentityQuery } from "@/shared/api/hooks";
import { MessageSquareOff, Pin } from "lucide-react";
import { plainRelayErrorMessage } from "@/shared/lib/relayError";
import { Button } from "@/shared/ui/button";

import { useChannelPinsQuery, useUnpinMessageMutation } from "../hooks";
import { type ChannelPin, pinEventsBy, pinPreview } from "../pinModels";

const TEST_ID = "pinned-messages";

/** "3 Oct, 09:12": the workspace's 24 hour clock beside the message's day. */
const MESSAGE_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
});
const MESSAGE_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatMessageWhen(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.getDate()} ${MESSAGE_DAY_FORMATTER.format(date)}, ${MESSAGE_CLOCK_FORMATTER.format(date)}`;
}

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
  variant = "list",
}: {
  channelId: string;
  /** Replaces the default empty text (the Pins screen keeps its own scene). */
  empty?: React.ReactNode;
  /** `page` is the Pins screen's card per pin; `list` is the compact rows. */
  variant?: "list" | "page";
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

  const lookupJobTitle = useJobTitleLookup(variant === "page");
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

  if (variant === "page") {
    return (
      <div className="c3pin-list" data-testid={TEST_ID}>
        {query.isError ? (
          <div
            className="c3pin-stale"
            data-testid={`${TEST_ID}-stale`}
            role="status"
          >
            <span>Pinned messages could not be refreshed.</span>
            <Button
              onClick={() => void query.refetch()}
              size="xs"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        <ul aria-label="Pinned messages" className="c3pin-cards">
          {pins.map((pin) => {
            const mine = pinEventsBy(pin, me).length > 0;
            const pending = pin.pins.some((record) =>
              record.pinEventId.startsWith("pending:"),
            );
            const target = pin.target;
            const pinnedLine = `Pinned by ${label(pin.pinnedBy)}${
              pin.pinnedAt ? ` · ${formatPinned(pin.pinnedAt)}` : ""
            }`;
            const pinnedByLine = (
              <span className="c3pin-pinned">
                <Pin aria-hidden="true" className="size-3.5" />
                {pinnedLine}
              </span>
            );
            if (target.state !== "message") {
              return (
                <li
                  className="c3pin-card"
                  data-state="unavailable"
                  data-testid={`${TEST_ID}-row-${pin.targetId}`}
                  key={pin.targetId}
                >
                  <div
                    className="c3pin-unavailable"
                    data-testid={`${TEST_ID}-unavailable-${pin.targetId}`}
                  >
                    <span className="c3pin-unavailable-icon">
                      <MessageSquareOff aria-hidden="true" className="size-5" />
                    </span>
                    <div className="c3pin-card-body">
                      <strong className="c3pin-unavailable-title">
                        This message is no longer available
                      </strong>
                      <span className="c3pin-unavailable-sub">
                        It was deleted, or you can't read it.
                      </span>
                      {pinnedByLine}
                    </div>
                  </div>
                </li>
              );
            }
            const author = target.author;
            const authorProfile = profiles?.[author.toLowerCase()];
            const title = lookupJobTitle(author);
            const when = formatMessageWhen(target.createdAt);
            return (
              <li
                className="c3pin-card"
                data-testid={`${TEST_ID}-row-${pin.targetId}`}
                key={pin.targetId}
              >
                <ProfileAvatar
                  avatarUrl={authorProfile?.avatarUrl ?? null}
                  className="c3pin-avatar"
                  label={label(author)}
                  pubkey={author}
                  shape={authorProfile?.isAgent ? "squircle" : "circle"}
                />
                <div className="c3pin-card-body">
                  <div className="c3pin-card-head">
                    <strong>{label(author)}</strong>
                    <span>{title ? `${title} · ${when}` : when}</span>
                  </div>
                  <p className="c3pin-card-text">
                    {pinPreview(target.content) || "Message with no text"}
                  </p>
                  <div className="c3pin-card-foot">
                    {pinnedByLine}
                    <span className="flex-1" />
                    <button
                      aria-label={`Open pinned message from ${label(author)}`}
                      className="c3pin-open"
                      data-testid={`${TEST_ID}-open-${pin.targetId}`}
                      onClick={() =>
                        void goChannel(channelId, { messageId: pin.targetId })
                      }
                      type="button"
                    >
                      Open message
                    </button>
                    {mine ? (
                      <button
                        aria-label={`Unpin the message from ${label(author)}`}
                        className="c3pin-unpin"
                        data-testid={`${TEST_ID}-unpin-${pin.targetId}`}
                        disabled={pending || unpin.isPending}
                        onClick={() => onUnpin(pin)}
                        type="button"
                      >
                        Unpin
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {query.data?.truncated ? (
          <p className="c3pin-truncated">Showing the most recent pins only.</p>
        ) : null}
      </div>
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
