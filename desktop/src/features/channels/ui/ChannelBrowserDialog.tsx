import * as React from "react";
import { ArrowLeft, Compass, Search, type LucideIcon } from "lucide-react";

import type { Channel } from "@/shared/api/types";
import {
  canonicalChannelName,
  channelNamesMatch,
} from "@/features/channels/lib/canonicalChannelName";
import { scoreChannelMatch } from "@/features/channels/lib/channelSearchScore";
import {
  type ChannelSortMode,
  sortChannelsForSidebar,
} from "@/features/sidebar/lib/channelSortPreference";
import { CheckIcon, CloseIcon, PlusIcon } from "@/shared/ui/colonyIcons";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";
import { cn } from "@/shared/lib/cn";
import {
  ChevronDownGlyph,
  SearchGlyph,
  SpeechGlyph,
} from "@/features/channels/ui/dialogIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  type CreateChannelInput,
  useCreateChannelForm,
} from "@/features/sidebar/lib/useCreateChannelForm";
import {
  CREATE_CHANNEL_FORM_ID,
  CreateChannelFormFields,
  CreateChannelFormFooter,
} from "@/features/sidebar/ui/CreateChannelFormFields";

type BrowserTab = "all" | "joined" | "archived";
type ChannelSort = ChannelSortMode | "members";

const CHANNEL_SORT_OPTIONS: { label: string; value: ChannelSort }[] = [
  { label: "Alphabetical", value: "alpha" },
  { label: "Recent", value: "recent" },
  { label: "Most members", value: "members" },
];

function BrowseState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-base font-semibold tracking-tight">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

type ChannelBrowserDialogProps = {
  channels: Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoinChannel: (channelId: string) => Promise<void>;
  onSelectChannel: (channelId: string) => void;
  /**
   * Create a new channel from within the browser. When provided, the
   * dialog surfaces a "Create …" affordance (Are.na style) so search and
   * create live behind a single entry point.
   */
  onCreateChannel?: (input: CreateChannelInput) => Promise<void>;
  isCreatingChannel?: boolean;
};

export function ChannelBrowserDialog({
  channels,
  open,
  onOpenChange,
  onJoinChannel,
  onSelectChannel,
  onCreateChannel,
  isCreatingChannel = false,
}: ChannelBrowserDialogProps) {
  const [query, setQuery] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<BrowserTab>("all");
  const [sort, setSort] = React.useState<ChannelSort>("alpha");
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [joiningChannelId, setJoiningChannelId] = React.useState<string | null>(
    null,
  );
  const [mode, setMode] = React.useState<"browse" | "create">("browse");
  const [createInitialName, setCreateInitialName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const canonicalQuery = canonicalChannelName(query);
  const deferredQuery = React.useDeferredValue(canonicalQuery.toLowerCase());
  const trimmedQuery = canonicalQuery;
  // Immediate (non-deferred) lowercased query. The create row's visibility
  // (via hasExactMatch) and its label both read from the live query so they
  // can never disagree for a frame while the fuzzy filter catches up.
  const normalizedQuery = trimmedQuery.toLowerCase();

  const canCreate = Boolean(onCreateChannel);
  const browseTitle = "Browse channels";
  const searchPlaceholder = "Search channels by name or description";
  const entityLabel = "channel";

  const noopCreate = React.useCallback(async () => {}, []);
  const createForm = useCreateChannelForm({
    channelKind: "stream",
    active: open && mode === "create",
    initialName: createInitialName,
    isCreating: isCreatingChannel,
    onCreate: onCreateChannel ?? noopCreate,
    onCreated: () => onOpenChange(false),
  });

  // Fuzzy match score per channel id for the current query, so both filtering
  // and relevance-ordering share one source of truth. Empty when no query.
  const matchScoreById = React.useMemo(() => {
    const scores = new Map<string, number>();
    if (deferredQuery.length === 0) return scores;
    for (const channel of channels) {
      const score = scoreChannelMatch(channel, deferredQuery);
      if (score !== null) scores.set(channel.id, score);
    }
    return scores;
  }, [channels, deferredQuery]);

  const matchingChannels = React.useMemo(() => {
    // Forums are no longer part of the app; leftover forum channels stay out
    // of the browse list.
    const filtered = channels.filter(
      (channel) =>
        channel.channelType !== "dm" &&
        channel.channelType !== "forum" &&
        (channel.archivedAt
          ? channel.isMember
          : channel.visibility === "open" || channel.isMember),
    );

    if (deferredQuery.length === 0) {
      return filtered;
    }

    return filtered.filter((channel) => matchScoreById.has(channel.id));
  }, [channels, deferredQuery, matchScoreById]);

  const currentChannels = React.useMemo(
    () => matchingChannels.filter((channel) => channel.archivedAt === null),
    [matchingChannels],
  );

  const joinedChannels = React.useMemo(
    () => currentChannels.filter((channel) => channel.isMember),
    [currentChannels],
  );

  const archivedChannels = React.useMemo(
    () => matchingChannels.filter((channel) => channel.archivedAt !== null),
    [matchingChannels],
  );

  const visibleChannels =
    activeTab === "archived"
      ? archivedChannels
      : activeTab === "joined"
        ? joinedChannels
        : matchingChannels;

  // The directory historically enters this dialog in alphabetical order.
  // Keep that as the tie order for Recent and relevance sorting even though
  // channel queries now preserve their authored order for sidebar groups.
  const alphabetizedVisibleChannels = React.useMemo(
    () => sortChannelsForSidebar(visibleChannels, "alpha"),
    [visibleChannels],
  );

  const isSearching = deferredQuery.length > 0;

  const orderedVisibleChannels = React.useMemo(() => {
    const sorted =
      sort === "members"
        ? [...alphabetizedVisibleChannels].sort(
            (a, b) =>
              b.memberCount - a.memberCount ||
              a.name.localeCompare(b.name, undefined, {
                sensitivity: "base",
              }),
          )
        : sortChannelsForSidebar(alphabetizedVisibleChannels, sort);

    if (!isSearching) return sorted;

    return sorted.sort(
      (a, b) =>
        (matchScoreById.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (matchScoreById.get(b.id) ?? Number.POSITIVE_INFINITY),
    );
  }, [alphabetizedVisibleChannels, isSearching, matchScoreById, sort]);

  const selectedSortLabel =
    CHANNEL_SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    "Alphabetical";

  const allTabLabel = "All channels";

  // Whether an exact name match already exists — if so we don't offer to
  // create a duplicate, mirroring how you'd never make two "#general"s.
  const hasExactMatch = React.useMemo(
    () =>
      channels.some(
        (channel) =>
          channel.channelType !== "dm" &&
          channelNamesMatch(channel.name, normalizedQuery),
      ),
    [channels, normalizedQuery],
  );

  // The pinned create row (Are.na style) appears for any non-empty query that
  // isn't already an exact channel name — covering both partial-match and
  // no-match cases, so a dedicated empty-state button would be redundant.
  // The create row is present from the moment the dialog opens (so it's clear
  // you can browse *or* create), then specializes to "Create «query»" as you
  // type. It only hides when the query is an exact match for an existing name
  // — creating a duplicate "#general" makes no sense.
  const showCreateRow = canCreate && !hasExactMatch;

  // The create row participates in keyboard navigation as a virtual item so
  // arrow keys reach it and Enter activates it — not just Tab. It's rendered
  // pinned at the top, so it takes nav index 0 and channels shift down by one,
  // keeping keyboard order identical to visual order.
  const channelNavOffset = showCreateRow ? 1 : 0;
  const createRowIndex = showCreateRow ? 0 : null;
  const navItemCount = orderedVisibleChannels.length + channelNavOffset;
  const isCreateRowSelected =
    createRowIndex !== null && selectedIndex === createRowIndex;

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveTab("all");
      setSort("alpha");
      setSelectedIndex(null);
      setJoiningChannelId(null);
      setMode("browse");
      setCreateInitialName("");
      return;
    }
  }, [open]);

  React.useEffect(() => {
    setSelectedIndex((current) => {
      if (current === null || navItemCount === 0) {
        return null;
      }

      return Math.min(current, navItemCount - 1);
    });
  }, [navItemCount]);

  async function handleJoin(channelId: string) {
    setJoiningChannelId(channelId);

    try {
      await onJoinChannel(channelId);
      onOpenChange(false);
      onSelectChannel(channelId);
    } catch {
      setJoiningChannelId(null);
    }
  }

  function handleSelect(channel: Channel) {
    onOpenChange(false);
    onSelectChannel(channel.id);
  }

  function enterCreateMode(prefillName: string) {
    setCreateInitialName(prefillName);
    setMode("create");
  }

  function exitCreateMode() {
    setMode("browse");
    // Return focus to the search field so keyboard users stay oriented.
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  const emptyTitle =
    deferredQuery.length > 0
      ? `No ${entityLabel}s match your search`
      : activeTab === "archived"
        ? `No archived ${entityLabel}s`
        : activeTab === "joined"
          ? `No joined ${entityLabel}s`
          : `No ${entityLabel}s to browse`;
  const emptyDescription =
    deferredQuery.length > 0
      ? canCreate
        ? `No ${entityLabel} by that name yet — create it to get started.`
        : "Try a different name or keyword."
      : activeTab === "archived"
        ? `Archived ${entityLabel}s you have joined will appear here.`
        : activeTab === "joined"
          ? `${entityLabel[0].toUpperCase()}${entityLabel.slice(1)}s you join will appear here.`
          : `All open ${entityLabel}s are available in the sidebar. Create a new ${entityLabel} to get started.`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-5rem)] max-w-[640px] gap-[18px] overflow-hidden px-7 pb-5 pt-7"
        data-testid="channel-browser-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (mode === "browse") {
            inputRef.current?.focus({ preventScroll: true });
          }
        }}
        showCloseButton={false}
      >
        {mode === "create" ? (
          <ChannelCreateView
            entityLabel={entityLabel}
            form={createForm}
            onBack={exitCreateMode}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3">
              <DialogTitle className="flex-1 leading-[normal]">
                {browseTitle}
              </DialogTitle>
              <DialogClose
                aria-label="Close"
                className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.6875rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
              >
                <CloseIcon size={17} strokeWidth={2.4} />
              </DialogClose>
            </div>
            <div className="shrink-0">
              <div className="flex h-[3.125rem] items-center gap-2.5 rounded-[0.8125rem] border border-colony-border-strong bg-colony-pop px-3.5 text-colony-muted transition-colors focus-within:border-colony-accent">
                <label
                  className="flex min-w-0 flex-1 cursor-text items-center gap-2.5"
                  htmlFor="channel-browser-search"
                >
                  <SearchGlyph
                    className="shrink-0"
                    size={18}
                    strokeWidth={2.2}
                  />
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="block h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-colony-fg shadow-none outline-hidden placeholder:text-[var(--colony-placeholder)]"
                    data-testid="channel-browser-search"
                    id="channel-browser-search"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelectedIndex(null);
                    }}
                    onKeyDown={(event) => {
                      // Arrow keys traverse the pinned create row (index 0)
                      // and the channel list beneath it, in visual order.
                      if (event.key === "ArrowDown" && navItemCount > 0) {
                        event.preventDefault();
                        setSelectedIndex((current) =>
                          current === null
                            ? 0
                            : Math.min(current + 1, navItemCount - 1),
                        );
                        return;
                      }

                      if (event.key === "ArrowUp" && navItemCount > 0) {
                        event.preventDefault();
                        setSelectedIndex((current) =>
                          current === null
                            ? navItemCount - 1
                            : Math.max(current - 1, 0),
                        );
                        return;
                      }

                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        const currentQuery = canonicalChannelName(
                          event.currentTarget.value,
                        );
                        const currentNormalizedQuery =
                          currentQuery.toLowerCase();
                        const currentCreateRowAvailable =
                          canCreate &&
                          !channels.some(
                            (channel) =>
                              channel.channelType !== "dm" &&
                              channelNamesMatch(
                                channel.name,
                                currentNormalizedQuery,
                              ),
                          );
                        const currentQueryChannels = channels.filter(
                          (channel) =>
                            channel.channelType !== "dm" &&
                            channel.channelType !== "forum" &&
                            (channel.archivedAt
                              ? channel.isMember
                              : channel.visibility === "open" ||
                                channel.isMember) &&
                            (activeTab === "archived"
                              ? channel.archivedAt !== null
                              : activeTab === "joined"
                                ? channel.archivedAt === null &&
                                  channel.isMember
                                : true) &&
                            (currentNormalizedQuery.length === 0 ||
                              scoreChannelMatch(
                                channel,
                                currentNormalizedQuery,
                              ) !== null),
                        );
                        const alphabetizedCurrentQueryChannels =
                          sortChannelsForSidebar(currentQueryChannels, "alpha");
                        const sortedCurrentQueryChannels =
                          sort === "members"
                            ? alphabetizedCurrentQueryChannels.sort(
                                (a, b) =>
                                  b.memberCount - a.memberCount ||
                                  a.name.localeCompare(b.name, undefined, {
                                    sensitivity: "base",
                                  }),
                              )
                            : sortChannelsForSidebar(
                                alphabetizedCurrentQueryChannels,
                                sort,
                              );
                        if (currentNormalizedQuery.length > 0) {
                          sortedCurrentQueryChannels.sort(
                            (a, b) =>
                              (scoreChannelMatch(a, currentNormalizedQuery) ??
                                Number.POSITIVE_INFINITY) -
                              (scoreChannelMatch(b, currentNormalizedQuery) ??
                                Number.POSITIVE_INFINITY),
                          );
                        }
                        const selectedIndexIsCurrent =
                          currentQuery === trimmedQuery;
                        const currentSelectedIndex = selectedIndexIsCurrent
                          ? selectedIndex
                          : null;
                        const currentChannelNavOffset =
                          currentCreateRowAvailable ? 1 : 0;
                        const currentCreateRowIsSelected =
                          currentCreateRowAvailable &&
                          currentSelectedIndex === 0;

                        // If the create row is highlighted — or it's the only
                        // actionable item (no channel matches) — Enter creates.
                        if (
                          currentCreateRowAvailable &&
                          (currentCreateRowIsSelected ||
                            sortedCurrentQueryChannels.length === 0)
                        ) {
                          event.preventDefault();
                          enterCreateMode(currentQuery);
                          return;
                        }

                        if (sortedCurrentQueryChannels.length > 0) {
                          event.preventDefault();
                          const selectedChannel =
                            currentSelectedIndex !== null &&
                            !currentCreateRowIsSelected
                              ? sortedCurrentQueryChannels[
                                  currentSelectedIndex - currentChannelNavOffset
                                ]
                              : undefined;
                          handleSelect(
                            selectedChannel ?? sortedCurrentQueryChannels[0],
                          );
                        }
                      }
                    }}
                    placeholder={searchPlaceholder}
                    ref={inputRef}
                    spellCheck={false}
                    type="text"
                    value={query}
                  />
                </label>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2.5">
              <Tabs
                onValueChange={(value) => {
                  setActiveTab(value as BrowserTab);
                  setSelectedIndex(null);
                }}
                value={activeTab}
              >
                <TabsList className="h-auto gap-0.5 rounded-xl p-[3px]">
                  {(
                    [
                      ["all", allTabLabel],
                      ["joined", "Joined"],
                      ["archived", "Archived"],
                    ] as const
                  ).map(([value, label]) => (
                    <TabsTrigger
                      className="h-[2.125rem] rounded-[0.5625rem] px-3.5 text-chip data-[state=active]:font-extrabold data-[state=active]:shadow-[0_1px_2px_rgba(60,40,80,0.12)]"
                      key={value}
                      value={value}
                    >
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <span className="flex-1" />
              <div className="flex items-center gap-2 text-xs font-bold text-colony-fg-secondary">
                Sort
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Sort ${entityLabel}s: ${selectedSortLabel}`}
                      className="flex h-[2.375rem] items-center gap-2 rounded-[0.625rem] border border-colony-border-strong bg-colony-pop py-0 pl-2.5 pr-2 text-chip font-semibold text-colony-fg transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
                      data-testid="channel-browser-sort"
                      type="button"
                    >
                      {selectedSortLabel}
                      <ChevronDownGlyph
                        className="text-colony-fg-secondary"
                        size={14}
                        strokeWidth={2.4}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      onValueChange={(value) => {
                        setSort(value as ChannelSort);
                        setSelectedIndex(null);
                      }}
                      value={sort}
                    >
                      {CHANNEL_SORT_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          data-testid={`channel-browser-sort-${option.value}`}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="-mx-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto">
              {showCreateRow ? (
                <>
                  <CreateChannelRow
                    entityLabel={entityLabel}
                    isSelected={isCreateRowSelected}
                    onClick={() => enterCreateMode(trimmedQuery)}
                    query={trimmedQuery}
                  />
                  <div className="mx-2.5 my-1.5 h-px shrink-0 bg-colony-border" />
                </>
              ) : null}

              {orderedVisibleChannels.length === 0 ? (
                <BrowseState
                  description={emptyDescription}
                  icon={deferredQuery.length > 0 ? Search : Compass}
                  title={emptyTitle}
                />
              ) : (
                orderedVisibleChannels.map((channel, index) => (
                  <ChannelCard
                    channel={channel}
                    isJoining={joiningChannelId === channel.id}
                    isSelected={index + channelNavOffset === selectedIndex}
                    key={channel.id}
                    onJoin={
                      !channel.isMember
                        ? () => {
                            void handleJoin(channel.id);
                          }
                        : undefined
                    }
                    onSelect={() => handleSelect(channel)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateChannelRow({
  entityLabel,
  isSelected,
  onClick,
  query,
}: {
  entityLabel: string;
  isSelected: boolean;
  onClick: () => void;
  query: string;
}) {
  const hasQuery = query.length > 0;
  return (
    <button
      className={cn(
        "flex w-full shrink-0 items-center gap-3.5 rounded-colony-chip px-2.5 py-3 text-left text-colony-fg transition-colors hover:bg-colony-wash/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
        isSelected && "bg-colony-wash/80",
      )}
      data-testid="channel-browser-create-row"
      data-selected={isSelected}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-colony-control-lg bg-colony-accent-soft text-colony-accent-ink">
        <PlusIcon size={18} strokeWidth={2.4} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {hasQuery ? (
          <span className="text-sm font-extrabold">
            Create {entityLabel} “{query}”
          </span>
        ) : (
          <span className="text-sm font-extrabold">
            Create a new {entityLabel}
          </span>
        )}
        <span className="text-xs font-medium text-colony-muted">
          Name it, describe it, make it private.
        </span>
      </span>
    </button>
  );
}

function ChannelCreateView({
  entityLabel,
  form,
  onBack,
  onClose,
}: {
  entityLabel: string;
  form: ReturnType<typeof useCreateChannelForm>;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-[min(72vh,40rem)] flex-col gap-5">
      <div className="flex shrink-0 items-center gap-3">
        <button
          aria-label="Back to search"
          className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.6875rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          data-testid="channel-browser-create-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <DialogTitle className="min-w-0 flex-1 truncate">
          {`New ${entityLabel}`}
        </DialogTitle>
        <button
          aria-label="Close"
          className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.6875rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          onClick={onClose}
          type="button"
        >
          <CloseIcon size={17} strokeWidth={2.4} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <form id={CREATE_CHANNEL_FORM_ID} onSubmit={form.handleSubmit}>
          <CreateChannelFormFields form={form} />
        </form>
      </div>

      <div className="shrink-0">
        <CreateChannelFormFooter form={form} />
      </div>
    </div>
  );
}

function ChannelCard({
  channel,
  isJoining,
  isSelected,
  onJoin,
  onSelect,
}: {
  channel: Channel;
  isJoining: boolean;
  isSelected: boolean;
  onJoin?: () => void;
  onSelect: () => void;
}) {
  const memberLabel = `${channel.memberCount} ${
    channel.memberCount === 1 ? "member" : "members"
  }`;
  const archived = Boolean(channel.archivedAt);
  const TypeIcon =
    channel.channelType === "forum"
      ? SpeechGlyph
      : channel.visibility === "private"
        ? PrivateChannelIcon
        : HashIcon;

  return (
    <div
      className={cn(
        "group/channel-row flex shrink-0 items-center gap-3.5 rounded-colony-chip px-2.5 py-3 transition-colors hover:bg-colony-wash/80",
        isSelected && "bg-colony-wash/80",
      )}
      data-testid={`browse-channel-${channel.name}`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-3.5 border-0 bg-transparent p-0 text-left text-colony-fg outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        type="button"
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-colony-control-lg bg-colony-track transition-colors group-hover/channel-row:bg-colony-pop",
            isSelected && "bg-colony-pop",
            archived ? "text-colony-muted" : "text-colony-fg-secondary",
          )}
        >
          <TypeIcon size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 text-sm font-extrabold",
              archived && "text-colony-fg-secondary",
            )}
          >
            <span className="truncate">{channel.name}</span>
            {archived ? (
              <span className="inline-flex h-[1.375rem] shrink-0 items-center rounded-full bg-colony-idle px-2 text-[calc(12.5*var(--colony-px))] font-extrabold text-colony-fg-secondary">
                archived
              </span>
            ) : null}
          </span>
          <span className="truncate text-xs font-medium text-colony-muted">
            <span>{memberLabel}</span>
            {channel.description ? (
              <>
                <span className="px-1">·</span>
                <span title={channel.description}>{channel.description}</span>
              </>
            ) : null}
          </span>
        </span>
      </button>

      {archived ? (
        <button
          className="shrink-0 text-chip font-extrabold text-colony-accent-ink underline underline-offset-2 hover:text-colony-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          type="button"
        >
          View
        </button>
      ) : channel.isMember ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-colony-success">
          <CheckIcon size={16} strokeWidth={2.4} />
          Joined
        </span>
      ) : onJoin ? (
        <Button
          className={cn(
            "h-[2.375rem] shrink-0 rounded-[0.625rem] px-4 text-chip font-bold",
            isSelected
              ? "border-transparent bg-colony-fg text-colony-surface hover:bg-colony-fg/90"
              : "group-hover/channel-row:border-transparent group-hover/channel-row:bg-colony-fg group-hover/channel-row:text-colony-surface",
          )}
          disabled={isJoining}
          onClick={(event) => {
            event.stopPropagation();
            onJoin();
          }}
          type="button"
          variant="outline"
        >
          {isJoining ? "Joining..." : "Join"}
        </Button>
      ) : null}
    </div>
  );
}
