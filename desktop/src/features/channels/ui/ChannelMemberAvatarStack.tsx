import * as React from "react";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { ChannelMember } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { UserAvatar } from "@/shared/ui/UserAvatar";

const MAX_VISIBLE_AVATARS = 3;

export function ChannelMemberAvatarStack({
  currentPubkey,
  members,
  size = "default",
  testId = "channel-management-member-avatar-stack",
}: {
  currentPubkey?: string;
  members: ChannelMember[];
  size?: "compact" | "default";
  testId?: string;
}) {
  const orderedMembers = React.useMemo(() => {
    if (size !== "compact" || !currentPubkey) return members;
    const normalizedCurrentPubkey = normalizePubkey(currentPubkey);
    return [
      ...members.filter(
        (member) => normalizePubkey(member.pubkey) !== normalizedCurrentPubkey,
      ),
      ...members.filter(
        (member) => normalizePubkey(member.pubkey) === normalizedCurrentPubkey,
      ),
    ];
  }, [currentPubkey, members, size]);
  const visibleMembers = orderedMembers.slice(0, MAX_VISIBLE_AVATARS);
  const visiblePubkeys = React.useMemo(
    () =>
      orderedMembers
        .slice(0, MAX_VISIBLE_AVATARS)
        .map((member) => member.pubkey),
    [orderedMembers],
  );
  const profilesQuery = useUsersBatchQuery(visiblePubkeys);
  const profiles = profilesQuery.data?.profiles;
  const avatarSizeClass = size === "compact" ? "!h-6 !w-6" : "!h-8 !w-8";
  const avatarOverlapClass = size === "compact" ? "-ml-1.5" : "-ml-2";
  const overflowSizeClass = size === "compact" ? "size-6" : "size-8";
  const overflowCount = orderedMembers.length - visibleMembers.length;
  const stackItemCount = visibleMembers.length + (overflowCount > 0 ? 1 : 0);

  if (members.length === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center pl-3" data-testid={testId}>
      {visibleMembers.map((member, index) => {
        const normalizedPubkey = normalizePubkey(member.pubkey);
        const profile = profiles?.[normalizedPubkey];
        const label = resolveUserLabel({
          currentPubkey,
          fallbackName: member.displayName,
          profiles,
          pubkey: member.pubkey,
        });
        const avatarLabel =
          size === "compact" &&
          currentPubkey &&
          normalizedPubkey === normalizePubkey(currentPubkey)
            ? (member.displayName ?? label)
            : label;

        return (
          <span
            className={index > 0 ? avatarOverlapClass : ""}
            data-testid="channel-management-member-avatar"
            key={normalizedPubkey}
            style={{ zIndex: index + 1 }}
          >
            <UserAvatar
              avatarUrl={profile?.avatarUrl ?? null}
              className={`${avatarSizeClass} border-2 border-background text-2xs`}
              displayName={avatarLabel}
              fallbackDelayMs={0}
              shape={profile?.isAgent ? "squircle" : "circle"}
            />
          </span>
        );
      })}
      {overflowCount > 0 ? (
        <span
          className={`${avatarOverlapClass} ${overflowSizeClass} flex items-center justify-center rounded-full border-2 border-background bg-muted text-2xs font-semibold text-muted-foreground`}
          data-testid="channel-management-member-avatar-overflow"
          style={{ zIndex: stackItemCount }}
          title={`${overflowCount} more members`}
        >
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
