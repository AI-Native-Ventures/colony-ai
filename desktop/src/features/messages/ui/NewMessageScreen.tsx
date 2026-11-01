import * as React from "react";
import { Mail } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useOpenDmMutation,
  useUpsertCachedChannel,
} from "@/features/channels/hooks";
import type { Channel } from "@/shared/api/types";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { getKeyboardSearchSelection } from "@/features/profile/lib/userCandidateSearch";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { SelectedRecipientChip } from "@/features/profile/ui/SelectedRecipientChip";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Skeleton } from "@/shared/ui/skeleton";

import { MessageComposer } from "./MessageComposer";
import { NewMessageResultRow } from "./NewMessageResultRow";
import {
  formatRecipientName,
  useNewMessageRecipients,
} from "./useNewMessageRecipients";

/**
 * Conversation-shaped compose surface for starting a direct message. The
 * normal chat header becomes an inline "To:" field, while recipient discovery
 * lives in an attached popover instead of taking over the message area.
 */
/** "Aya and Zinhle Dlamini", "A, B and C". */
function joinRecipientNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function NewMessageScreen() {
  const identityQuery = useIdentityQuery();
  const currentPubkey = identityQuery.data?.pubkey;
  const openDmMutation = useOpenDmMutation();
  const upsertCachedChannel = useUpsertCachedChannel();
  const sendMessageMutation = useSendMessageMutation(null, identityQuery.data);
  const { goChannel } = useAppNavigation();

  const [isRecipientPickerOpen, setIsRecipientPickerOpen] =
    React.useState(true);
  const [highlightedRecipientPubkey, setHighlightedRecipientPubkey] =
    React.useState<string | null>(null);
  const [inspectedRecipientPubkey, setInspectedRecipientPubkey] =
    React.useState<string | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = React.useState<
    string | null
  >(null);
  const [isPreparingMentionSend, setIsPreparingMentionSend] =
    React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const toFieldRef = React.useRef<HTMLDivElement>(null);
  const preparedDirectMessageRef = React.useRef<Channel | null>(null);
  const isMountedRef = React.useRef(false);
  const isPending =
    isPreparingMentionSend ||
    openDmMutation.isPending ||
    sendMessageMutation.isPending;

  const {
    deferredSearchQuery,
    handleDirectoryScroll,
    hasReachedRecipientLimit,
    isDirectoryLoading,
    ownerProfiles,
    removeUser,
    searchError,
    searchQuery,
    searchResults,
    selectUser,
    selectedUsers,
    setSearchQuery,
  } = useNewMessageRecipients({ active: true, currentPubkey });

  const isSearchTransitionPending = searchQuery.trim() !== deferredSearchQuery;
  const visibleSearchResults =
    isSearchTransitionPending || isDirectoryLoading ? [] : searchResults;
  const showRecipientPicker = isRecipientPickerOpen && !isPending;
  const highlightedRecipientIndex = React.useMemo(() => {
    if (!showRecipientPicker || visibleSearchResults.length === 0) {
      return -1;
    }

    if (highlightedRecipientPubkey === null) {
      return 0;
    }

    return visibleSearchResults.findIndex(
      (user) => user.pubkey === highlightedRecipientPubkey,
    );
  }, [highlightedRecipientPubkey, showRecipientPicker, visibleSearchResults]);
  const highlightedRecipient =
    highlightedRecipientIndex < 0
      ? null
      : (visibleSearchResults[highlightedRecipientIndex] ?? null);

  React.useEffect(() => {
    if (
      highlightedRecipientPubkey &&
      !isSearchTransitionPending &&
      highlightedRecipientIndex < 0
    ) {
      setHighlightedRecipientPubkey(null);
    }
  }, [
    highlightedRecipientIndex,
    highlightedRecipientPubkey,
    isSearchTransitionPending,
  ]);

  React.useEffect(() => {
    if (!highlightedRecipient || !showRecipientPicker) {
      return;
    }

    document
      .getElementById(`new-dm-option-${highlightedRecipient.pubkey}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedRecipient, showRecipientPicker]);

  React.useEffect(() => {
    isMountedRef.current = true;
    searchInputRef.current?.focus({ preventScroll: true });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRemoveUser = React.useCallback(
    (pubkey: string) => {
      preparedDirectMessageRef.current = null;
      setInspectedRecipientPubkey((current) =>
        current === pubkey ? null : current,
      );
      removeUser(pubkey);
    },
    [removeUser],
  );

  const handleSelectUser = React.useCallback(
    (user: Parameters<typeof selectUser>[0]) => {
      preparedDirectMessageRef.current = null;
      selectUser(user);
      setHighlightedRecipientPubkey(null);
      setSubmitErrorMessage(null);
      setIsRecipientPickerOpen(true);
      searchInputRef.current?.focus({ preventScroll: true });
    },
    [selectUser],
  );

  const handleResultSelect = React.useCallback(
    (user: Parameters<typeof selectUser>[0]) => {
      const isSelected = selectedUsers.some(
        (selectedUser) => selectedUser.pubkey === user.pubkey,
      );
      if (isSelected) {
        setSearchQuery("");
        setHighlightedRecipientPubkey(null);
        setSubmitErrorMessage(null);
        setIsRecipientPickerOpen(true);
        searchInputRef.current?.focus({ preventScroll: true });
        return;
      }

      handleSelectUser(user);
    },
    [handleSelectUser, selectedUsers, setSearchQuery],
  );

  const openDirectMessage = React.useCallback(
    async (additionalParticipantPubkeys: string[] = []) => {
      const requestedPubkeys = [
        ...new Set(
          [
            ...selectedUsers.map((user) => user.pubkey),
            ...additionalParticipantPubkeys,
          ].map(normalizePubkey),
        ),
      ].filter(Boolean);
      const preparedDirectMessage = preparedDirectMessageRef.current;
      const currentNormalizedPubkey = currentPubkey
        ? normalizePubkey(currentPubkey)
        : null;
      const preparedParticipantPubkeys = new Set(
        (preparedDirectMessage?.participantPubkeys ?? [])
          .map(normalizePubkey)
          .filter((pubkey) => pubkey !== currentNormalizedPubkey),
      );
      if (
        preparedDirectMessage &&
        preparedParticipantPubkeys.size === requestedPubkeys.length &&
        requestedPubkeys.every((pubkey) =>
          preparedParticipantPubkeys.has(pubkey),
        )
      ) {
        return preparedDirectMessage;
      }

      if (
        openDmMutation.isPending ||
        sendMessageMutation.isPending ||
        requestedPubkeys.length === 0
      ) {
        return null;
      }

      setSubmitErrorMessage(null);

      try {
        const directMessage = await openDmMutation.mutateAsync({
          pubkeys: requestedPubkeys,
        });
        preparedDirectMessageRef.current = directMessage;
        return directMessage;
      } catch (error) {
        setSubmitErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to open direct message.",
        );
        return null;
      }
    },
    [
      currentPubkey,
      openDmMutation.isPending,
      openDmMutation.mutateAsync,
      selectedUsers,
      sendMessageMutation.isPending,
    ],
  );

  const prepareSendChannel = React.useCallback(
    async (additionalParticipantPubkeys: string[] = []) => {
      const directMessage = await openDirectMessage(
        additionalParticipantPubkeys,
      );
      return directMessage?.id ?? null;
    },
    [openDirectMessage],
  );

  const sendFirstMessage = React.useCallback(
    async (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      targetChannelId?: string | null,
    ) => {
      const preparedDirectMessage = preparedDirectMessageRef.current;
      const directMessage =
        targetChannelId && preparedDirectMessage?.id === targetChannelId
          ? preparedDirectMessage
          : await openDirectMessage();
      if (!directMessage) {
        throw new Error(
          submitErrorMessage ?? "Choose at least one recipient first.",
        );
      }

      try {
        await sendMessageMutation.mutateAsync({
          targetChannel: directMessage,
          content,
          mentionPubkeys,
          mediaTags,
          // A newly opened DM is not subscribed yet, so publish its first
          // message through the acknowledged HTTP path. This avoids holding
          // the entire navigation on a WebSocket OK frame that staging may
          // never deliver.
          transport: "http",
        });
      } catch (error) {
        preparedDirectMessageRef.current = null;
        const message =
          error instanceof Error ? error.message : "Failed to send message.";
        if (isMountedRef.current) setSubmitErrorMessage(message);
        throw error;
      }

      if (!isMountedRef.current) {
        return;
      }

      await upsertCachedChannel(directMessage);
      if (!isMountedRef.current) {
        return;
      }
      await goChannel(directMessage.id, { replace: true });
    },
    [
      goChannel,
      openDirectMessage,
      sendMessageMutation,
      submitErrorMessage,
      upsertCachedChannel,
    ],
  );

  const composerPlaceholder =
    selectedUsers.length === 0
      ? "Choose a recipient to start a message"
      : selectedUsers.length === 1
        ? `Message ${formatRecipientName(selectedUsers[0])}`
        : `Message ${selectedUsers.length} people`;

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="new-message-page"
    >
      <div className="c3nm-title" data-testid="new-message-title">
        <Mail aria-hidden="true" className="size-5" />
        <h1>New message</h1>
      </div>
      <header
        className="c3nm-to-bar relative z-40 shrink-0 cursor-default select-none"
        data-testid="new-message-header"
        data-tauri-drag-region
      >
        <div className="flex min-w-0 items-center">
          <Popover
            onOpenChange={(open) => {
              setIsRecipientPickerOpen(
                open || inspectedRecipientPubkey !== null,
              );
            }}
            open={showRecipientPicker}
          >
            <PopoverAnchor asChild>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere in the recipient field focuses its input */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the nested combobox is the keyboard-accessible focus target */}
              <div
                className="group/to-field flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-2"
                data-testid="new-message-to-field"
                onClick={(event) => {
                  // Portaled popovers (recipient inspection and its nested key
                  // copy) still bubble through React's tree to this handler,
                  // but their event targets are not DOM descendants of the
                  // field. Those clicks belong to the popover's own controls
                  // — they must not steal focus into the search input (which
                  // dismisses the popover via focus-outside) or reopen the
                  // picker. Only clicks physically within the recipient field
                  // focus its input.
                  const { currentTarget, target } = event;
                  if (
                    !(target instanceof Node) ||
                    !currentTarget.contains(target)
                  ) {
                    return;
                  }
                  setIsRecipientPickerOpen(true);
                  searchInputRef.current?.focus({ preventScroll: true });
                }}
                ref={toFieldRef}
              >
                <span className="c3nm-to-label">To:</span>
                {selectedUsers.map((user) => (
                  <SelectedRecipientChip
                    disabled={isPending}
                    inspectionOpen={inspectedRecipientPubkey === user.pubkey}
                    key={user.pubkey}
                    label={formatRecipientName(user)}
                    onInspectionOpenChange={(inspectionOpen) => {
                      setInspectedRecipientPubkey(
                        inspectionOpen ? user.pubkey : null,
                      );
                    }}
                    onRemove={() => handleRemoveUser(user.pubkey)}
                    variant="field"
                    testIds={{
                      chip: `new-dm-selected-${user.pubkey}`,
                      keyPopover: `new-dm-selected-key-popover-${user.pubkey}`,
                      name: `new-dm-recipient-name-${user.pubkey}`,
                      pubkey: `new-dm-selected-pubkey-${user.pubkey}`,
                    }}
                    user={user}
                  />
                ))}
                <input
                  aria-activedescendant={
                    highlightedRecipient
                      ? `new-dm-option-${highlightedRecipient.pubkey}`
                      : undefined
                  }
                  aria-controls="new-dm-results"
                  aria-expanded={showRecipientPicker}
                  aria-label="To"
                  autoComplete="off"
                  autoCorrect="off"
                  className="c3nm-to-input"
                  data-testid="new-dm-search"
                  disabled={isPending}
                  id="new-dm-search"
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setHighlightedRecipientPubkey(null);
                    setSubmitErrorMessage(null);
                    setIsRecipientPickerOpen(true);
                  }}
                  onFocus={() => setIsRecipientPickerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (inspectedRecipientPubkey) {
                        setInspectedRecipientPubkey(null);
                        return;
                      }
                      setHighlightedRecipientPubkey(null);
                      setIsRecipientPickerOpen(false);
                      return;
                    }

                    if (
                      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                      visibleSearchResults.length > 0
                    ) {
                      event.preventDefault();
                      setIsRecipientPickerOpen(true);
                      setHighlightedRecipientPubkey(() => {
                        const current = highlightedRecipientIndex;
                        if (current < 0) {
                          const initialIndex =
                            event.key === "ArrowDown"
                              ? 0
                              : visibleSearchResults.length - 1;
                          return (
                            visibleSearchResults[initialIndex]?.pubkey ?? null
                          );
                        }

                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        const nextIndex =
                          (current + direction + visibleSearchResults.length) %
                          visibleSearchResults.length;
                        return visibleSearchResults[nextIndex]?.pubkey ?? null;
                      });
                      return;
                    }

                    if (
                      event.key === "Backspace" &&
                      searchQuery.length === 0 &&
                      selectedUsers.length > 0
                    ) {
                      event.preventDefault();
                      const lastRecipient =
                        selectedUsers[selectedUsers.length - 1];
                      if (lastRecipient) {
                        document
                          .querySelector<HTMLElement>(
                            `[data-testid="new-dm-selected-${lastRecipient.pubkey}"]`,
                          )
                          ?.dispatchEvent(
                            new MouseEvent("click", {
                              bubbles: true,
                              detail: 0,
                            }),
                          );
                      }
                      return;
                    }

                    if (event.key !== "Enter") {
                      return;
                    }

                    if (searchQuery.trim().length === 0) {
                      if (highlightedRecipient) {
                        event.preventDefault();
                        handleSelectUser(highlightedRecipient);
                      }
                      return;
                    }

                    const keyboardSelection =
                      highlightedRecipient ??
                      getKeyboardSearchSelection({
                        currentQuery: searchQuery,
                        rankedQuery: deferredSearchQuery,
                        results: visibleSearchResults,
                      });
                    if (!keyboardSelection) {
                      return;
                    }

                    event.preventDefault();
                    handleResultSelect(keyboardSelection);
                  }}
                  ref={searchInputRef}
                  role="combobox"
                  spellCheck={false}
                  type="text"
                  value={searchQuery}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              alignOffset={48}
              className="c3nm-popover"
              data-testid="new-message-recipient-popover"
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                const target = event.detail.originalEvent.target;
                if (
                  target instanceof Element &&
                  (toFieldRef.current?.contains(target) ||
                    Boolean(target.closest("[data-recipient-key-popover]")))
                ) {
                  event.preventDefault();
                }
              }}
              onOpenAutoFocus={(event) => event.preventDefault()}
              side="bottom"
              sideOffset={10}
            >
              <div
                className="c3nm-results"
                data-testid="new-dm-results"
                id="new-dm-results"
                onScroll={handleDirectoryScroll}
                role="listbox"
              >
                {visibleSearchResults.length > 0 ? (
                  <div className="c3nm-results-list">
                    {visibleSearchResults.map((user) => {
                      const isSelected = selectedUsers.some(
                        (selectedUser) => selectedUser.pubkey === user.pubkey,
                      );
                      return (
                        <NewMessageResultRow
                          currentPubkey={currentPubkey}
                          disabled={
                            isPending ||
                            (hasReachedRecipientLimit && !isSelected)
                          }
                          isAlreadySelected={isSelected}
                          isKeyboardHighlighted={
                            highlightedRecipient?.pubkey === user.pubkey
                          }
                          key={user.pubkey}
                          onSelect={handleResultSelect}
                          ownerProfiles={ownerProfiles}
                          user={user}
                        />
                      );
                    })}
                  </div>
                ) : isDirectoryLoading || isSearchTransitionPending ? (
                  <div
                    aria-busy="true"
                    aria-label="Loading people and agents"
                    className="c3nm-results-note space-y-3"
                    data-testid="new-dm-loading"
                    role="status"
                  >
                    {["w-40", "w-32", "w-48"].map((nameWidth) => (
                      <div className="flex items-center gap-3" key={nameWidth}>
                        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <Skeleton className={`h-4 ${nameWidth}`} />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="c3nm-results-note" data-testid="new-dm-empty">
                    {deferredSearchQuery.length === 0
                      ? "No people or agents available to message."
                      : "No matching users."}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {isPending ? (
            <span
              className="shrink-0 pl-2 text-sm text-muted-foreground"
              data-testid="new-dm-opening"
            >
              Opening…
            </span>
          ) : null}
        </div>
      </header>

      <div className="c3nm-body" data-testid="new-message-body">
        {selectedUsers.length > 0 ? (
          <div className="c3nm-hero" data-testid="new-message-hero">
            <span aria-hidden="true" className="c3nm-hero-avatars">
              {selectedUsers.slice(0, 3).map((user) => (
                <ProfileAvatar
                  avatarUrl={user.avatarUrl}
                  className="c3nm-hero-avatar"
                  key={user.pubkey}
                  label={formatRecipientName(user)}
                  pubkey={user.pubkey}
                  shape={user.isAgent ? "squircle" : "circle"}
                />
              ))}
            </span>
            <p className="c3nm-hero-names">
              {joinRecipientNames(selectedUsers.map(formatRecipientName))}
            </p>
            <p className="c3nm-hero-hint" data-testid="new-dm-limit">
              DMs support up to nine people, including you.
            </p>
          </div>
        ) : null}
      </div>

      {searchError ? (
        <p className="px-5 pb-2 text-sm text-destructive">
          {searchError.message}
        </p>
      ) : null}
      {submitErrorMessage ? (
        <p className="px-5 pb-2 text-sm text-destructive">
          {submitErrorMessage}
        </p>
      ) : null}

      <MessageComposer
        channelName="new message"
        channelType="dm"
        containerClassName="c3nm-composer"
        toolbarLayout="new-message"
        disabled={isPending || selectedUsers.length === 0}
        isSending={isPending}
        onPrepareSendChannel={prepareSendChannel}
        onPreparingMentionSendChange={setIsPreparingMentionSend}
        onSend={sendFirstMessage}
        placeholder={composerPlaceholder}
        showBackgroundUploadProgress
      />
    </div>
  );
}
