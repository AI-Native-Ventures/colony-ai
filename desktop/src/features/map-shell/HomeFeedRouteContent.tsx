import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { HomeScreen } from "@/features/home/ui/HomeScreen";
import { useChannelsQuery } from "@/features/channels/hooks";
import type { InboxFilter } from "@/features/home/lib/inbox";
import { useIdentityQuery } from "@/shared/api/hooks";

export type HomeRouteSearch = {
  filter?: InboxFilter;
  item?: string;
  profile?: string;
  profileTab?: string;
  profileView?: string;
};

const HOME_FILTERS: InboxFilter[] = [
  "all",
  "mention",
  "thread",
  "needs_action",
  "agent_activity",
  "drafts",
];

export function validateHomeSearch(
  search: Record<string, unknown>,
): HomeRouteSearch {
  return {
    filter:
      typeof search.filter === "string" &&
      HOME_FILTERS.includes(search.filter as InboxFilter)
        ? (search.filter as InboxFilter)
        : undefined,
    item:
      typeof search.item === "string" && search.item.length > 0
        ? search.item
        : undefined,
    profile:
      typeof search.profile === "string" && search.profile.length > 0
        ? search.profile
        : undefined,
    profileTab:
      typeof search.profileTab === "string" && search.profileTab.length > 0
        ? search.profileTab
        : undefined,
    profileView:
      typeof search.profileView === "string" && search.profileView.length > 0
        ? search.profileView
        : undefined,
  };
}

export function HomeFeedRouteContent({
  filter,
}: {
  filter: InboxFilter | undefined;
}) {
  const { goChannel } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const channels = channelsQuery.data ?? [];
  const availableChannelIds = React.useMemo(
    () => new Set(channels.map((channel) => channel.id)),
    [channels],
  );

  return (
    <HomeScreen
      availableChannelIds={availableChannelIds}
      currentPubkey={identityQuery.data?.pubkey}
      initialFilter={filter}
      onOpenContext={(channelId, messageId, threadRootId) => {
        void goChannel(channelId, { messageId, threadRootId });
      }}
    />
  );
}
