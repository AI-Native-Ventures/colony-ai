import { Globe, Hash } from "lucide-react";
import type * as React from "react";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { cn } from "@/shared/lib/cn";
import { PrivateChannelIcon } from "@/shared/ui/colonyIcons";

export type ChannelIntroAction = {
  description?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
};

export type ChannelIntro = {
  actions?: ChannelIntroAction[];
  channelId?: string;
  channelKindLabel: string;
  channelName: string;
  currentPubkey?: string;
  description?: string | null;
  hideBeginning?: boolean;
  icon?: React.ReactNode;
  visibility?: "open" | "private";
};

const PEOPLE_SHOWN = 3;

function formatPeopleHere(names: string[]): string {
  if (names.length === 1) return `${names[0]} is here`;
  const head = names.slice(0, -1).join(", ");
  return `${head} and ${names[names.length - 1]} are here`;
}

/** Who is in the channel: a small stack of faces and a line naming them. */
function ChannelIntroPeople({
  channelId,
  currentPubkey,
}: {
  channelId: string;
  currentPubkey?: string;
}) {
  const membersQuery = useChannelMembersQuery(channelId);
  const self = currentPubkey ? normalizePubkey(currentPubkey) : null;
  const others = (membersQuery.data ?? [])
    .filter((member) => normalizePubkey(member.pubkey) !== self)
    .slice(0, PEOPLE_SHOWN);
  const profilesQuery = useUsersBatchQuery(
    others.map((member) => member.pubkey),
    { enabled: others.length > 0 },
  );
  if (others.length === 0) return null;
  const profiles = profilesQuery.data?.profiles;
  const names = others.map(
    (member) =>
      profiles?.[normalizePubkey(member.pubkey)]?.displayName?.trim() ||
      member.displayName?.trim() ||
      "Someone",
  );
  return (
    <>
      <span
        aria-hidden="true"
        className="flex"
        data-testid="message-channel-intro-faces"
      >
        {others.map((member, index) => (
          <ProfileAvatar
            avatarUrl={
              profiles?.[normalizePubkey(member.pubkey)]?.avatarUrl ?? null
            }
            className={cn(
              "size-[calc(30*var(--colony-px))] text-3xs ring-2 ring-colony-surface",
              index > 0 && "-ml-1.5",
            )}
            key={member.pubkey}
            label={names[index]}
            shape={member.isAgent ? "squircle" : "circle"}
          />
        ))}
      </span>
      <span
        className="c3c-intro-people"
        data-testid="message-channel-intro-people"
      >
        {formatPeopleHere(names)}
      </span>
    </>
  );
}

/**
 * The top of a channel's history: what the channel is, who is in it, and (for
 * a welcome or onboarding channel) the first things to do. Rendered both as
 * the virtualized timeline's leading row and as the non-virtualized state, so
 * the two cannot drift and the first message always lands below it without
 * layout shift.
 */
export function ChannelIntroBlock({
  className,
  intro,
}: {
  className?: string;
  intro: ChannelIntro;
}) {
  const isPrivate = intro.visibility === "private";
  return (
    <section
      aria-label={`About #${intro.channelName}`}
      className={cn(
        "flex w-full flex-col items-start gap-2.5 border-b border-colony-border pb-6",
        className,
      )}
      data-testid="message-channel-intro"
    >
      <span
        className="grid size-[calc(58*var(--colony-px))] place-items-center rounded-[calc(17*var(--colony-px))] bg-colony-accent-soft text-colony-accent-ink"
        data-testid="message-channel-intro-icon"
      >
        {intro.icon ??
          (isPrivate ? (
            <PrivateChannelIcon aria-hidden size={26} />
          ) : (
            <Hash aria-hidden className="size-[calc(26*var(--colony-px))]" />
          ))}
      </span>
      <h2
        className="c3c-intro-title mt-1"
        data-testid="message-channel-intro-title"
      >
        {intro.channelName}
      </h2>
      {intro.description ? (
        <p className="c3c-intro-text max-w-[calc(620*var(--colony-px))] whitespace-pre-line">
          {intro.description}
        </p>
      ) : null}
      {intro.channelId ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
          <ChannelIntroPeople
            channelId={intro.channelId}
            currentPubkey={intro.currentPubkey}
          />
          <span aria-hidden="true" className="text-colony-faint">
            ·
          </span>
          <span
            className="c3c-intro-chip"
            data-testid="message-channel-intro-visibility"
          >
            {isPrivate ? (
              <PrivateChannelIcon aria-hidden size={14} />
            ) : (
              <Globe aria-hidden className="size-[calc(14*var(--colony-px))]" />
            )}
            {isPrivate ? "Private channel" : "Open channel"}
          </span>
        </div>
      ) : null}
      {intro.actions?.length ? (
        <div className="mt-2 flex max-w-full flex-nowrap gap-2 overflow-x-auto p-1">
          {intro.actions.map((action) => (
            <button
              className="flex h-[calc(46*var(--colony-px))] shrink-0 items-center gap-2.5 rounded-xl bg-colony-wash px-3.5 text-left text-colony-fg transition-colors hover:bg-colony-accent-soft focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={action.testId}
              key={action.label}
              onClick={action.onClick}
              type="button"
            >
              <span
                className="flex shrink-0 items-center text-colony-fg-secondary"
                data-testid={
                  action.testId ? `${action.testId}-icon` : undefined
                }
              >
                {action.icon}
              </span>
              <span
                className="c3c-button whitespace-nowrap"
                data-testid={
                  action.testId ? `${action.testId}-title` : undefined
                }
              >
                {action.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
