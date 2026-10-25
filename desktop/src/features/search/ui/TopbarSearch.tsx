import { SearchIcon } from "@/shared/ui/colonyIcons";
import * as React from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { useWorkingChannels } from "@/features/agents/agentWorkingSignal";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { useJobTitleLookup } from "@/features/company-team/useJobTitleLookup";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { readChannelSectionsStore } from "@/features/sidebar/lib/channelSectionsStorage";
import { getPlatformKeysById } from "@/shared/lib/keyboard-shortcuts";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { getMinimumSearchQueryLength } from "@/features/search/hooks";
import { parseSearchOperators } from "@/features/search/lib/parseSearchOperators";
import { buildSearchResultPreview } from "@/features/search/lib/searchMatch";
import { useSearchResults } from "@/features/search/useSearchResults";
import {
  resultIcon,
  resultKey,
  resultTestId,
  type SearchResult,
} from "@/features/search/ui/SearchResultItem";
import {
  CurrentChannelSearchAction,
  getChannelScopeLabel,
  SearchDialogInputRow,
} from "@/features/search/ui/SearchScopeControls";
import { HighlightedSearchText } from "@/features/search/ui/HighlightedSearchText";
import { useSearchMenuKeyboardNavigation } from "@/features/search/ui/useSearchMenuKeyboardNavigation";
import type { Channel, SearchHit, UserSearchResult } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";
import { Skeleton } from "@/shared/ui/skeleton";
type TopbarSearchProps = {
  channelLabels?: Record<string, string>;
  channels: Channel[];
  className?: string;
  currentPubkey?: string;
  currentChannelId?: string | null;
  focusRequest?: number;
  onOpenChannel: (channelId: string) => void;
  onOpenResult: (hit: SearchHit, query: string) => void;
  onOpenUser?: (user: UserSearchResult) => void | Promise<void>;
  onBrowseChannels?: () => void | Promise<void>;
  onCreateAgent?: () => void | Promise<void>;
  onCreateChannel?: () => void | Promise<void>;
  suggestionChannels?: Channel[];
  scopeFocusRequest?: number;
  variant?: "bar" | "icon";
};
const MAX_SEARCH_SUGGESTIONS = 4;
const SEARCH_RESULT_LIMIT = 40;
const SEARCH_SECTION_TITLE_CLASS = "c3s-section";
const SEARCH_RESULT_SECTION_ORDER = [
  "channels",
  "direct-messages",
  "people",
  "agents",
  "messages",
  "actions",
] as const;
type SearchResultSectionKey = (typeof SEARCH_RESULT_SECTION_ORDER)[number];
type SearchResultSection = {
  key: SearchResultSectionKey;
  results: SearchResult[];
  title: string;
};
type SearchHitContextLabel = {
  channelLabel: string | null;
  text: string;
};
function formatRelativeTime(unixSeconds: number) {
  const diff = Math.floor(Date.now() / 1_000) - unixSeconds;
  if (diff < 60) {
    return "just now";
  }

  if (diff < 60 * 60) {
    return `${Math.floor(diff / 60)}m ago`;
  }

  if (diff < 60 * 60 * 24) {
    return `${Math.floor(diff / (60 * 60))}h ago`;
  }

  if (diff < 60 * 60 * 24 * 7) {
    return `${Math.floor(diff / (60 * 60 * 24))}d ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(unixSeconds * 1_000));
}

const SEARCH_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const SEARCH_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
});

/** "09:12" today, "Yesterday", "Mon" this week, then the date. */
function formatSearchWhen(unixSeconds: number) {
  const then = new Date(unixSeconds * 1_000);
  const now = new Date(Date.now());
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(now) - startOfDay(then)) / (24 * 60 * 60 * 1_000),
  );
  if (dayDiff <= 0) return SEARCH_CLOCK_FORMATTER.format(then);
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return SEARCH_WEEKDAY_FORMATTER.format(then);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(then);
}

function getChannelActivityTime(channel: Channel) {
  if (!channel.lastMessageAt) {
    return 0;
  }

  const timestamp = Date.parse(channel.lastMessageAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getChannelSuggestionMeta(channel: Channel) {
  const activityTime = getChannelActivityTime(channel);

  if (activityTime > 0) {
    return formatRelativeTime(Math.floor(activityTime / 1_000));
  }

  return null;
}

function getChannelDisplayName(
  channel: Channel,
  channelLabels?: Record<string, string>,
) {
  return channelLabels?.[channel.id]?.trim() || channel.name;
}

function getChannelPreview(channel: Channel) {
  if (channel.channelType === "dm") {
    return "Direct message";
  }

  if (channel.description.trim()) {
    return channel.description;
  }

  return "";
}

function getUserDisplayName(user: UserSearchResult) {
  return (
    user.displayName?.trim() ||
    user.nip05Handle?.trim() ||
    truncateNpub(user.pubkey)
  );
}

function getUserSecondaryLabel(user: UserSearchResult) {
  const displayName = user.displayName?.trim();
  const nip05Handle = user.nip05Handle?.trim();

  if (nip05Handle && nip05Handle !== displayName) {
    return nip05Handle;
  }

  return null;
}

function getSearchHitChannelName(
  hit: SearchHit,
  channelLookup: ReadonlyMap<string, Channel>,
  channelLabels?: Record<string, string>,
) {
  const channel = hit.channelId ? channelLookup.get(hit.channelId) : null;
  const channelName =
    (hit.channelId ? channelLabels?.[hit.channelId]?.trim() : null) ||
    hit.channelName?.trim() ||
    channel?.name.trim() ||
    null;

  if (!channelName) {
    return null;
  }

  return channelName;
}

function getSearchHitContextLabel(
  hit: SearchHit,
  channelLookup: ReadonlyMap<string, Channel>,
  channelLabels?: Record<string, string>,
): SearchHitContextLabel {
  const channel = hit.channelId ? channelLookup.get(hit.channelId) : null;
  const channelName = getSearchHitChannelName(
    hit,
    channelLookup,
    channelLabels,
  );

  if (channel?.channelType === "dm") {
    return {
      channelLabel: null,
      text: "Direct message",
    };
  }

  const isThread = hit.kind === 45003 || Boolean(hit.threadRootId);

  return {
    channelLabel: channelName,
    text: channelName
      ? `${isThread ? "Thread" : "Message"} in`
      : isThread
        ? "Thread"
        : "Message",
  };
}

function getResultSectionKey(result: SearchResult): SearchResultSectionKey {
  if (result.kind === "channel") {
    return result.channel.channelType === "dm" ? "direct-messages" : "channels";
  }

  if (result.kind === "user") {
    return result.user.isAgent ? "agents" : "people";
  }

  if (result.kind === "action") {
    return "actions";
  }

  return "messages";
}

function getSectionTitle(sectionKey: SearchResultSectionKey) {
  switch (sectionKey) {
    case "channels":
      return "Channels";
    case "direct-messages":
      return "Direct messages";
    case "people":
      return "People";
    case "agents":
      return "Agents";
    case "messages":
      return "Most relevant";
    case "actions":
      return "Actions";
  }
}

function SearchHitContextLine({
  label,
  when,
}: {
  label: SearchHitContextLabel;
  when: string;
}) {
  return (
    <span className="c3s-hit-context">
      {label.text}
      {label.channelLabel ? <> #{label.channelLabel}</> : null}
      {" · "}
      {when}
    </span>
  );
}

function groupSearchResults(results: SearchResult[]): SearchResultSection[] {
  const resultsBySection = new Map<SearchResultSectionKey, SearchResult[]>();

  for (const result of results) {
    const sectionKey = getResultSectionKey(result);
    const sectionResults = resultsBySection.get(sectionKey) ?? [];
    sectionResults.push(result);
    resultsBySection.set(sectionKey, sectionResults);
  }

  return SEARCH_RESULT_SECTION_ORDER.flatMap((sectionKey) => {
    const sectionResults = resultsBySection.get(sectionKey);

    if (!sectionResults || sectionResults.length === 0) {
      return [];
    }

    return [
      {
        key: sectionKey,
        results: sectionResults,
        title: getSectionTitle(sectionKey),
      },
    ];
  });
}

function getSuggestedSearchResults(channels: Channel[]) {
  return channels
    .filter(
      (channel) =>
        !channel.archivedAt &&
        channel.channelType !== "forum" &&
        (channel.isMember || channel.channelType === "dm"),
    )
    .sort((a, b) => {
      const activityDiff =
        getChannelActivityTime(b) - getChannelActivityTime(a);
      if (activityDiff !== 0) {
        return activityDiff;
      }

      const typeRank = (channel: Channel) =>
        channel.channelType === "dm"
          ? 0
          : channel.channelType === "stream"
            ? 1
            : 2;
      const rankDiff = typeRank(a) - typeRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SEARCH_SUGGESTIONS)
    .map((channel) => ({
      kind: "channel" as const,
      channel,
    }));
}

const searchSkeletonRows = [
  {
    iconShape: "rounded-md",
    key: "channel",
    metaWidth: "w-16",
    previewWidth: "w-48",
    titleWidth: "w-28",
    trailingWidth: "w-14",
  },
  {
    iconShape: "rounded-full",
    key: "message",
    metaWidth: "w-24",
    previewWidth: "w-72",
    titleWidth: "w-24",
    trailingWidth: "w-20",
  },
  {
    iconShape: "rounded-full",
    key: "note",
    metaWidth: "w-20",
    previewWidth: "w-60",
    titleWidth: "w-32",
    trailingWidth: "w-16",
  },
] as const;

function SearchResultsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="c3s-list"
      data-testid="search-results-loading"
    >
      {searchSkeletonRows.map((row) => (
        <div
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5"
          key={row.key}
        >
          <Skeleton className={cn("h-7 w-7 shrink-0", row.iconShape)} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Skeleton className={cn("h-4", row.titleWidth)} />
              <Skeleton className={cn("h-3", row.metaWidth)} />
            </div>
            <Skeleton
              className={cn("mt-1.5 h-3 max-w-full", row.previewWidth)}
            />
          </div>
          <Skeleton className={cn("h-3 shrink-0", row.trailingWidth)} />
        </div>
      ))}
    </div>
  );
}

export function TopbarSearch({
  channelLabels,
  channels,
  className,
  currentChannelId,
  currentPubkey,
  focusRequest = 0,
  onOpenChannel,
  onOpenResult,
  onOpenUser,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  scopeFocusRequest = 0,
  suggestionChannels,
  variant = "bar",
}: TopbarSearchProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [scopeChannelId, setScopeChannelId] = React.useState<string | null>(
    null,
  );
  const [selectedMenuIndex, setSelectedMenuIndex] = React.useState(0);
  const lookupJobTitle = useJobTitleLookup(isOpen);
  const { activeCommunity } = useCommunities();
  const channelSectionNames = React.useMemo(() => {
    if (!isOpen || !currentPubkey) return new Map<string, string>();
    const store = readChannelSectionsStore(
      currentPubkey,
      activeCommunity?.relayUrl,
    );
    const names = new Map(
      store.sections.map((section) => [section.id, section.name]),
    );
    return new Map(
      Object.entries(store.assignments).flatMap(([channelId, sectionId]) => {
        const name = names.get(sectionId);
        return name ? [[channelId, name] as const] : [];
      }),
    );
  }, [activeCommunity?.relayUrl, currentPubkey, isOpen]);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogInputRef = React.useRef<HTMLInputElement>(null);
  const { cancelDeferredModalOpen, openAfterExit, openNextFrame } =
    useDeferredModalOpen();
  const {
    channelLookup,
    debouncedQuery,
    fuzzyUserCandidatesQuery,
    isWaitingOnFromResolution,
    query,
    resultProfiles,
    results,
    searchQuery,
    setQuery,
    userSearchQuery,
  } = useSearchResults({
    channelLabels,
    channels,
    enabled: isOpen,
    limit: SEARCH_RESULT_LIMIT,
    scopeChannelId,
  });
  const workingChannels = useWorkingChannels();
  const knownAgentPubkeys = useKnownAgentPubkeys();
  const workingChannelByAgent = React.useMemo(() => {
    const byAgent = new Map<string, string>();
    for (const summary of workingChannels) {
      const channelName = channelLookup.get(summary.channelId)?.name;
      if (!channelName) continue;
      for (const pubkey of summary.agentPubkeys) {
        const key = normalizePubkey(pubkey);
        if (!byAgent.has(key)) byAgent.set(key, channelName);
      }
    }
    return byAgent;
  }, [channelLookup, workingChannels]);
  const dmChannelHasAgent = React.useCallback(
    (channel: Channel) =>
      channel.participantPubkeys.some((pubkey) =>
        knownAgentPubkeys.has(normalizePubkey(pubkey)),
      ),
    [knownAgentPubkeys],
  );
  const trimmedQuery = query.trim();
  // Bind highlights to the debounced result source so stale results can never
  // pair with newly typed text during the debounce window.
  const resultQuery = parseSearchOperators(debouncedQuery).text;
  const resultsAreCurrent = debouncedQuery === trimmedQuery;
  const isIconVariant = variant === "icon";
  const currentChannel = currentChannelId
    ? (channelLookup.get(currentChannelId) ?? null)
    : null;
  const scopeChannel = scopeChannelId
    ? (channelLookup.get(scopeChannelId) ?? null)
    : null;
  const scopeLabel = scopeChannel
    ? getChannelScopeLabel(scopeChannel, channelLabels, currentPubkey)
    : null;
  const currentPubkeyNormalized =
    currentPubkey && normalizePubkey(currentPubkey);
  const hasScopeAction = Boolean(currentChannel && !scopeChannel);
  const suggestedResults = React.useMemo(
    () => getSuggestedSearchResults(suggestionChannels ?? channels),
    [channels, suggestionChannels],
  );
  const suggestionActionResults = React.useMemo(() => {
    const actions: SearchResult[] = [];

    if (onBrowseChannels) {
      actions.push({
        kind: "action",
        action: {
          id: "browse-channels",
          title: "Browse channels",
        },
      });
    }

    if (onCreateChannel) {
      actions.push({
        kind: "action",
        action: {
          id: "create-channel",
          title: "Create a new channel",
        },
      });
    }

    if (onCreateAgent) {
      actions.push({
        kind: "action",
        action: {
          id: "create-agent",
          title: "Create a new agent",
        },
      });
    }

    return actions;
  }, [onBrowseChannels, onCreateAgent, onCreateChannel]);
  const suggestionResults = React.useMemo(
    () => [...suggestedResults, ...suggestionActionResults],
    [suggestedResults, suggestionActionResults],
  );
  const minimumQueryLength = getMinimumSearchQueryLength(scopeChannelId);
  const isShowingSuggestions =
    Math.max(debouncedQuery.length, trimmedQuery.length) < minimumQueryLength;
  const searchableResults = React.useMemo(
    () =>
      results.filter(
        (result) =>
          result.kind !== "user" ||
          normalizePubkey(result.user.pubkey) !== currentPubkeyNormalized,
      ),
    [currentPubkeyNormalized, results],
  );
  const visibleSearchableResults = resultsAreCurrent ? searchableResults : [];
  const searchResultSections = React.useMemo(
    () => groupSearchResults(visibleSearchableResults),
    [visibleSearchableResults],
  );
  const groupedSearchResults = React.useMemo(
    () => searchResultSections.flatMap((section) => section.results),
    [searchResultSections],
  );
  const activeResults = isShowingSuggestions
    ? scopeChannel
      ? []
      : suggestionResults
    : resultsAreCurrent
      ? groupedSearchResults
      : [];
  const isSearchLoading =
    (!isShowingSuggestions && !resultsAreCurrent) ||
    isWaitingOnFromResolution ||
    searchQuery.isLoading ||
    fuzzyUserCandidatesQuery.isLoading ||
    userSearchQuery.isLoading;

  const openSearchDialog = React.useCallback(
    (nextScopeChannelId: string | null = null) => {
      setScopeChannelId(nextScopeChannelId);
      setSelectedMenuIndex(0);
      openNextFrame(() => setIsOpen(true));
    },
    [openNextFrame],
  );

  const handleSearchOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openSearchDialog(null);
        return;
      }

      cancelDeferredModalOpen();
      setSelectedMenuIndex(0);
      setScopeChannelId(null);
      setIsOpen(false);
    },
    [cancelDeferredModalOpen, openSearchDialog],
  );

  const openResult = React.useCallback(
    (result: SearchResult) => {
      setIsOpen(false);
      setScopeChannelId(null);
      setQuery("");

      if (result.kind === "channel") {
        onOpenChannel(result.channel.id);
        return;
      }

      if (result.kind === "user") {
        void onOpenUser?.(result.user);
        return;
      }

      if (result.kind === "action") {
        setSelectedMenuIndex(0);
        if (result.action.id === "browse-channels") {
          openAfterExit(() => {
            void onBrowseChannels?.();
          });
        } else if (result.action.id === "create-channel") {
          openAfterExit(() => {
            void onCreateChannel?.();
          });
        } else {
          openAfterExit(() => {
            void onCreateAgent?.();
          });
        }
        return;
      }

      onOpenResult(result.hit, resultQuery);
    },
    [
      onBrowseChannels,
      onCreateAgent,
      onCreateChannel,
      onOpenChannel,
      onOpenResult,
      onOpenUser,
      openAfterExit,
      setQuery,
      resultQuery,
    ],
  );

  // Edge-trigger: the counter never resets, so `!== 0` would replay on remount.
  const lastFocusRequestRef = React.useRef(focusRequest);
  React.useEffect(() => {
    if (focusRequest === lastFocusRequestRef.current) {
      return;
    }
    lastFocusRequestRef.current = focusRequest;

    openSearchDialog(null);
  }, [focusRequest, openSearchDialog]);

  const lastScopeFocusRequestRef = React.useRef(scopeFocusRequest);
  React.useEffect(() => {
    if (scopeFocusRequest === lastScopeFocusRequestRef.current) {
      return;
    }
    lastScopeFocusRequestRef.current = scopeFocusRequest;

    if (currentChannelId) {
      openSearchDialog(currentChannelId);
    }
  }, [currentChannelId, openSearchDialog, scopeFocusRequest]);

  const focusDialogInput = React.useCallback(() => {
    window.requestAnimationFrame(() => dialogInputRef.current?.focus());
  }, []);

  const activateCurrentChannelScope = React.useCallback(() => {
    if (!currentChannel) return;
    setScopeChannelId(currentChannel.id);
    setSelectedMenuIndex(0);
    focusDialogInput();
  }, [currentChannel, focusDialogInput]);

  const removeChannelScope = React.useCallback(() => {
    setScopeChannelId(null);
    setSelectedMenuIndex(0);
    focusDialogInput();
  }, [focusDialogInput]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      dialogInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  const handleDialogInputKeyDown = useSearchMenuKeyboardNavigation({
    activeResults,
    hasLeadingAction: hasScopeAction,
    onActivateLeadingAction: activateCurrentChannelScope,
    onOpenResult: openResult,
    onRemoveScope: removeChannelScope,
    query,
    scopeActive: Boolean(scopeChannel),
    selectedMenuIndex,
    setSelectedMenuIndex,
  });

  const renderSearchResultRow = (
    result: SearchResult,
    index: number,
    inQueryResults = false,
  ) => {
    const menuIndex = index + (hasScopeAction ? 1 : 0);
    const channelDisplayName =
      result.kind === "channel"
        ? getChannelDisplayName(result.channel, channelLabels)
        : null;
    const userDisplayName =
      result.kind === "user" ? getUserDisplayName(result.user) : null;
    const messageAuthorLabel =
      result.kind === "message"
        ? resolveUserLabel({
            currentPubkey,
            profiles: resultProfiles,
            pubkey: result.hit.pubkey,
            preferResolvedSelfLabel: true,
          })
        : null;
    const messageContextLabel =
      result.kind === "message"
        ? getSearchHitContextLabel(result.hit, channelLookup, channelLabels)
        : null;
    const title =
      result.kind === "channel"
        ? channelDisplayName
        : result.kind === "action"
          ? result.action.title
          : result.kind === "user"
            ? userDisplayName
            : messageAuthorLabel;
    const channelSubtitle =
      result.kind === "channel" && inQueryResults
        ? [
            result.channel.channelType === "dm"
              ? "Direct message"
              : result.channel.visibility === "private"
                ? "Private"
                : "Open",
            channelSectionNames.get(result.channel.id) ??
              getChannelPreview(result.channel),
          ]
            .filter((part) => part && part !== "Direct message")
            .join(" · ") ||
          (result.channel.channelType === "dm" ? "Direct message" : "")
        : null;
    const userJobTitle =
      result.kind === "user" ? lookupJobTitle(result.user.pubkey) : null;
    const workingChannelName =
      result.kind === "user" && result.user.isAgent
        ? (workingChannelByAgent.get(normalizePubkey(result.user.pubkey)) ??
          null)
        : null;
    const userSubtitle =
      result.kind === "user"
        ? [
            userJobTitle,
            workingChannelName ? `Working in #${workingChannelName}` : null,
            getUserSecondaryLabel(result.user),
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
    const preview =
      result.kind === "channel"
        ? (channelSubtitle ?? getChannelPreview(result.channel))
        : result.kind === "action"
          ? result.action.description
          : result.kind === "user"
            ? userSubtitle
            : buildSearchResultPreview(result.hit.content, resultQuery);
    const trailingLabel =
      result.kind === "channel" && !inQueryResults
        ? getChannelSuggestionMeta(result.channel)
        : null;
    const actionShortcut =
      result.kind === "action"
        ? result.action.id === "browse-channels"
          ? getPlatformKeysById("browse-channels")
          : result.action.id === "create-channel"
            ? getPlatformKeysById("new-channel")
            : null
        : null;
    const isSelected = menuIndex === selectedMenuIndex;
    const isMessage = result.kind === "message";

    return (
      <button
        aria-selected={isSelected}
        className="search-result-row c3s-row"
        data-kind={result.kind}
        data-selected={isSelected ? "true" : undefined}
        key={resultKey(result)}
        onClick={() => openResult(result)}
        onMouseEnter={() => setSelectedMenuIndex(menuIndex)}
        role="option"
        type="button"
        data-testid={resultTestId(result)}
        data-search-result-index={menuIndex}
      >
        {result.kind === "message" ? (
          <ProfileAvatar
            avatarUrl={
              resultProfiles?.[result.hit.pubkey.toLowerCase()]?.avatarUrl ??
              null
            }
            className="c3s-avatar c3s-avatar-message"
            label={messageAuthorLabel ?? ""}
            shape={
              resultProfiles?.[result.hit.pubkey.toLowerCase()]?.isAgent ===
              true
                ? "squircle"
                : "circle"
            }
          />
        ) : result.kind === "user" ? (
          <ProfileAvatar
            avatarUrl={result.user.avatarUrl}
            className="c3s-avatar"
            label={userDisplayName ?? result.user.pubkey}
            shape={result.user.isAgent ? "squircle" : "circle"}
          />
        ) : result.kind === "channel" && result.channel.channelType === "dm" ? (
          <ProfileAvatar
            avatarUrl={null}
            className="c3s-avatar"
            label={channelDisplayName ?? ""}
            shape={dmChannelHasAgent(result.channel) ? "squircle" : "circle"}
          />
        ) : (
          <span
            className="c3s-icon"
            data-agent-action={
              result.kind === "action" && result.action.id === "create-agent"
                ? "true"
                : undefined
            }
          >
            {React.createElement(resultIcon(result, channelLookup), {
              className: "size-[1.125rem]",
            })}
          </span>
        )}
        <span className="c3s-text">
          {isMessage ? (
            <>
              <span className="c3s-hit-head">
                <strong>{title}</strong>
                {messageContextLabel ? (
                  <SearchHitContextLine
                    label={messageContextLabel}
                    when={formatSearchWhen(result.hit.createdAt)}
                  />
                ) : null}
              </span>
              {preview ? (
                <span className="c3s-hit-body">
                  <HighlightedSearchText query={resultQuery} text={preview} />
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span
                className="c3s-title"
                data-action={result.kind === "action" ? "true" : undefined}
              >
                {result.kind === "channel" || result.kind === "user" ? (
                  <HighlightedSearchText
                    query={resultQuery}
                    text={title ?? ""}
                  />
                ) : (
                  title
                )}
              </span>
              {preview ? (
                <span className="c3s-sub">
                  {result.kind === "channel" || result.kind === "user" ? (
                    <HighlightedSearchText query={resultQuery} text={preview} />
                  ) : (
                    preview
                  )}
                </span>
              ) : null}
            </>
          )}
        </span>
        {trailingLabel ? (
          <span className="c3s-trailing">{trailingLabel}</span>
        ) : null}
        {actionShortcut ? (
          <kbd className="c3s-kbd">{actionShortcut}</kbd>
        ) : null}
      </button>
    );
  };

  const renderSearchResultSections = (sections: SearchResultSection[]) => {
    let resultIndex = 0;

    return sections.map((section) => (
      <div
        className="c3s-group"
        data-search-section={section.key}
        key={section.key}
      >
        <div className={SEARCH_SECTION_TITLE_CLASS}>{section.title}</div>
        {section.results.map((result) =>
          renderSearchResultRow(result, resultIndex++, true),
        )}
      </div>
    ));
  };
  const currentChannelSearchAction =
    currentChannel && !scopeChannel ? (
      <CurrentChannelSearchAction
        channelLabel={getChannelScopeLabel(
          currentChannel,
          channelLabels,
          currentPubkey,
        )}
        channelType={currentChannel.channelType}
        isSelected={selectedMenuIndex === 0}
        onActivate={activateCurrentChannelScope}
        onMouseEnter={() => setSelectedMenuIndex(0)}
      />
    ) : null;
  const searchResultContent = isShowingSuggestions ? (
    scopeChannel ? null : suggestionResults.length === 0 ? (
      <div className="c3s-scroll">
        {currentChannelSearchAction}
        <div className="c3s-note">
          <p>No recent activity yet.</p>
        </div>
      </div>
    ) : (
      <div aria-label="Recent activity" className="c3s-scroll" role="listbox">
        {currentChannelSearchAction}
        <div className="c3s-list">
          {(() => {
            let resultIndex = 0;

            return (
              <>
                {suggestedResults.length > 0 ? (
                  <div className="c3s-group">
                    <div className={SEARCH_SECTION_TITLE_CLASS}>
                      Recent activity
                    </div>
                    {suggestedResults.map((result) =>
                      renderSearchResultRow(result, resultIndex++),
                    )}
                  </div>
                ) : null}
                {suggestionActionResults.length > 0 ? (
                  <div className="c3s-group" data-actions="true">
                    <div className={SEARCH_SECTION_TITLE_CLASS}>Actions</div>
                    {suggestionActionResults.map((result) =>
                      renderSearchResultRow(result, resultIndex++),
                    )}
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      </div>
    )
  ) : isSearchLoading && visibleSearchableResults.length === 0 ? (
    <div className="c3s-scroll">
      {currentChannelSearchAction}
      <SearchResultsSkeleton />
    </div>
  ) : searchQuery.error instanceof Error &&
    visibleSearchableResults.length === 0 ? (
    <div className="c3s-scroll">
      {currentChannelSearchAction}
      <p className="c3s-note c3s-note-error">{searchQuery.error.message}</p>
    </div>
  ) : visibleSearchableResults.length === 0 ? (
    <div className="c3s-scroll">
      {currentChannelSearchAction}
      <p className="c3s-note">
        No {scopeChannel ? "messages" : "matches"} for{" "}
        <span className="font-semibold">{trimmedQuery}</span>
        {scopeLabel ? (
          <>
            {" "}
            in <span className="font-semibold">{scopeLabel}</span>
          </>
        ) : null}
        .
      </p>
    </div>
  ) : (
    <div
      className="c3s-scroll"
      data-testid="search-results-list"
      role="listbox"
    >
      {currentChannelSearchAction}
      <div className="c3s-list">
        {renderSearchResultSections(searchResultSections)}
      </div>
    </div>
  );
  const searchFooter =
    isShowingSuggestions && suggestionResults.length > 0 && !scopeChannel ? (
      <div className="c3s-footer" data-testid="search-footer-hints">
        <span>↑ ↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </div>
    ) : !isShowingSuggestions ? (
      <div className="c3s-footer" data-testid="search-footer-operators">
        <span>Narrow it down with</span>
        <b>from:</b>
        <b>in:</b>
        <b>after:</b>
        <b>before:</b>
      </div>
    ) : null;
  return (
    <div className={cn("relative", className)}>
      <Dialog open={isOpen} onOpenChange={handleSearchOpenChange}>
        <button
          aria-label="Find anything"
          className={
            isIconVariant
              ? "group/search flex size-6 items-center justify-center rounded p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              : "group/search flex h-8 w-full items-center gap-2 rounded-md bg-sidebar-border/35 px-2 text-left text-xs text-sidebar-foreground/55 transition-colors duration-150 ease-out hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          }
          data-testid="open-search"
          onClick={() => openSearchDialog(null)}
          ref={triggerRef}
          title="Find anything"
          type="button"
        >
          <SearchIcon
            className={
              isIconVariant
                ? "h-4 w-4 shrink-0"
                : "h-4 w-4 shrink-0 text-sidebar-foreground/45 transition-colors duration-150 ease-out group-hover/search:text-sidebar-foreground/65 group-focus-visible/search:text-sidebar-foreground"
            }
          />
          {isIconVariant ? null : (
            <>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate transition-colors duration-150 ease-out",
                  query
                    ? "text-sidebar-foreground"
                    : "text-sidebar-foreground/55",
                )}
              >
                {query || "Find anything"}
              </span>
              <kbd className="shrink-0 text-3xs text-sidebar-foreground/45">
                &#x2318;K
              </kbd>
            </>
          )}
        </button>
        <DialogContent
          aria-busy={isSearchLoading && visibleSearchableResults.length === 0}
          className="c3s-dialog self-start gap-0 overflow-hidden p-0"
          data-testid="search-results"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogInputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">
            {scopeLabel ? `Search in ${scopeLabel}` : "Search everything"}
          </DialogTitle>
          <SearchDialogInputRow
            inputRef={dialogInputRef}
            onChange={(nextQuery) => {
              setQuery(nextQuery);
              setSelectedMenuIndex(0);
            }}
            onKeyDown={handleDialogInputKeyDown}
            onRemoveScope={removeChannelScope}
            query={query}
            scopeLabel={scopeLabel}
          />
          {searchResultContent}
          {searchFooter}
        </DialogContent>
      </Dialog>
    </div>
  );
}
