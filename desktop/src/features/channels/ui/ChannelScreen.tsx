// biome-ignore-all format: line-count ratchet requires compact forwarding in this legacy component
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import { useChannelPaneHandlers } from "@/features/channels/useChannelPaneHandlers";
import { useMessageEventProfilePubkeys } from "@/features/channels/useMessageEventProfilePubkeys";
import { useMessageOwnerProfiles } from "@/features/channels/useMessageOwnerProfiles";
import { useThreadTargetSync } from "@/features/channels/useThreadTargetSync";
import {
  useChannelMembersQuery,
  useJoinChannelMutation,
} from "@/features/channels/hooks";
import {
  MSG_PREFIX,
  THREAD_PREFIX,
} from "@/features/channels/readState/readStateFormat";
import { ChannelScreenEmptyState } from "@/features/channels/ui/ChannelScreenEmptyState";
import { ChannelScreenHeader } from "@/features/channels/ui/ChannelScreenHeader";
import { WorkAreaLayout } from "@/features/workarea/dock/WorkAreaLayout";
import { MembersSidebar } from "@/features/channels/ui/MembersSidebar";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { mergeChannelKnownAgentPubkeys } from "@/features/agents/knownAgentPubkeys";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { useWelcomeKickoffEntrance } from "@/features/onboarding/useWelcomeKickoffEntrance";
import { useWelcomeKickoffStagePresence } from "@/features/onboarding/useWelcomeKickoffStagePresence";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
  useChannelWindowQuery,
  useDeleteMessageMutation,
  useEditMessageMutation,
  useSendMessageMutation,
  useToggleReactionMutation,
} from "@/features/messages/hooks";
import { buildMessageComposerEditTarget } from "@/features/messages/lib/draftMentionRefs";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { DeleteMessageConfirmDialog } from "@/features/messages/ui/DeleteMessageConfirmDialog";
import {
  getThreadReference,
  isThreadReply,
} from "@/features/messages/lib/threading";
import { hasPersistedHydratedChannel } from "@/features/messages/lib/channelHeadCache";
import { resolveTimelineQueryLoadingState } from "@/features/messages/lib/timelineLoadingState";
import { useFetchOlderMessages } from "@/features/messages/useFetchOlderMessages";
import { useIndependentThreadPanel } from "@/features/messages/useIndependentThreadPanel";
import { useThreadReplies } from "@/features/messages/useThreadReplies";
import { useChannelTyping } from "@/features/messages/useChannelTyping";
import type { TimelineMessage } from "@/features/messages/types";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import type {
  ChannelMember,
  RelayEvent,
  RespondToMode,
} from "@/shared/api/types";
import { useChannelResolvedMessages } from "@/features/channels/ui/useChannelResolvedMessages";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import { useMainInsetRef } from "@/shared/layout/MainInsetContext";
import { channelContentTopPaddingMeasurement } from "@/shared/layout/chromeLayout";
import { useMeasuredCssVariable } from "@/shared/layout/useMeasuredCssVariable";
import { useElementWidth } from "@/shared/hooks/use-mobile";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { useChannelActivityTyping } from "./useChannelActivityTyping";
import { useMessageProfiles } from "./useMessageProfiles";
import { useChannelPanelHistoryState } from "./useChannelPanelHistoryState";
import { useChannelProfilePanel } from "./useChannelProfilePanel";
import { useChannelTargetReset } from "./useChannelTargetReset";
import { useChannelRouteTarget } from "./useChannelRouteTarget";
import { useChannelOpenReadState } from "./useChannelOpenReadState";
import { useChannelUnreadState } from "./useChannelUnreadState";
import type { ChannelScreenProps } from "./ChannelScreen.types";
import { GuardedChannelPane } from "./GuardedChannelPane"; import { useNavigationGuard } from "./useNavigationGuard"; import * as searchForwarding from "./searchTargetForwarding";
const EMPTY_RELAY_EVENTS: RelayEvent[] = [];
// The Colony sidebar is 220px, narrower than the previous shell. A 640px
// content breakpoint keeps the same window widths single-panel as before.
const CHANNEL_SINGLE_PANEL_CONTENT_BREAKPOINT_PX = 640;
const EMPTY_CHANNEL_MEMBERS: ChannelMember[] = [];

/** The Colony 3.0 thread and settings panels are 380px wide (400px for settings, which shares this width). */
const CHANNEL_PANEL_DEFAULT_WIDTH_PX = 380;

export function ChannelScreen({
  activeChannel,
  autoSendDraftKey,
  currentIdentity,
  currentProfile,
  headerEndActions, idleAuxiliaryPanel,
  idleAuxiliaryHeaderActions, idleAuxiliaryOverridesThread,
  idleAuxiliaryTitle,
  onCloseIdleAuxiliaryPanel,
  targetMessageEvents, targetMessageId,
  ...searchTarget
}: ChannelScreenProps) {
  const queryClient = useQueryClient();
  const { goHome, goSettings } = useAppNavigation();
  const { activeCommunity } = useCommunities();
  const {
    clearChannelUnreadSource,
    markChannelUnread,
    getChannelReadAt,
    getMessageReadAt,
    markMessageRead,
    setContextParentResolver,
    followThread,
    unfollowThread,
    isFollowingThread,
    isNotifiedForThread,
    recordThreadInteraction,
    isThreadMuted,
    readStateVersion,
  } = useAppShell();
  const {
    channelManagementOpen,
    clearAutoSend,
    clearMessageRouteTarget,
    openProfilePanel,
    openThreadHeadId,
    profilePanelPubkey,
    profilePanelTab,
    profilePanelView,
    setChannelManagementOpen,
    setOpenThreadHeadId,
    setProfilePanelTab,
    setProfilePanelPubkey,
    setProfilePanelView,
  } = useChannelPanelHistoryState();
  const [channelContentRef, channelContentWidthPx] =
    useElementWidth<HTMLDivElement>();
  const {
    canReset: canResetThreadPanelWidth,
    onResetWidth: handleThreadPanelWidthReset,
    onResizeStart: handleThreadPanelResizeStart,
    widthPx: threadPanelWidthPx,
  } = useThreadPanelWidth(channelContentWidthPx || undefined, {
    defaultWidthPx: CHANNEL_PANEL_DEFAULT_WIDTH_PX,
  });
  const [isMembersSidebarOpen, setIsMembersSidebarOpen] = React.useState(false);
  const [isAddBotOpen, setIsAddBotOpen] = React.useState(false);
  const [expandedThreadReplyIds, setExpandedThreadReplyIds] = React.useState(
    () => new Set<string>(),
  );
  const [threadScrollTargetId, setThreadScrollTargetId] = React.useState<
    string | null
  >(null);
  const [threadReplyTargetId, setThreadReplyTargetId] = React.useState<
    string | null
  >(null);
  const [editTargetId, setEditTargetId] = React.useState<string | null>(null);
  const [optimisticOpenThreadHeadId, setOptimisticOpenThreadHeadId] =
    React.useState<string | null | undefined>(undefined);
  const clearOptimisticThreadOverride = React.useCallback(() => {
    setOptimisticOpenThreadHeadId(undefined);
  }, []);
  const mainInsetRef = useMainInsetRef();
  const currentPubkey = currentIdentity?.pubkey;
  const activeChannelId = activeChannel?.id ?? null;
  const relaySelfPubkey = useRelaySelfQuery(activeChannel !== null).data;
  const effectiveOpenThreadHeadId =
    optimisticOpenThreadHeadId === undefined
      ? openThreadHeadId
      : optimisticOpenThreadHeadId;
  const isNotifiedForEffectiveThread =
    effectiveOpenThreadHeadId != null
      ? isNotifiedForThread(effectiveOpenThreadHeadId)
      : false;
  const previousActiveChannelIdRef = React.useRef(activeChannelId);
  React.useEffect(() => {
    const didChangeChannel =
      previousActiveChannelIdRef.current !== activeChannelId;
    previousActiveChannelIdRef.current = activeChannelId;
    setOptimisticOpenThreadHeadId((current) => {
      if (current === undefined) {
        return current;
      }
      return didChangeChannel || openThreadHeadId === current
        ? undefined
        : current;
    });
  }, [activeChannelId, openThreadHeadId]);
  const messagesQuery = useChannelMessagesQuery(activeChannel);
  const windowQuery = useChannelWindowQuery(activeChannel);
  const threadRepliesQuery = useThreadReplies(
    activeChannel,
    effectiveOpenThreadHeadId,
    threadScrollTargetId,
  );
  useChannelSubscription(activeChannel);
  const { fetchOlder, hasOlderMessages, historyExhausted, isFetchingOlder } =
    useFetchOlderMessages(activeChannel);
  const latestActiveMessage = React.useMemo(() => {
    const messages = messagesQuery.data;
    if (!messages) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (getThreadReference(messages[index].tags).parentId === null)
        return messages[index];
    }
    return null;
  }, [messagesQuery.data]);
  const activeReadAt = latestActiveMessage
    ? new Date(latestActiveMessage.created_at * 1_000).toISOString()
    : null;
  useChannelOpenReadState(
    activeChannelId,
    activeChannel?.isMember,
    activeReadAt,
  );
  React.useEffect(() => {
    if (!activeChannelId) {
      setContextParentResolver(null);
      return;
    }
    setContextParentResolver((contextId) =>
      contextId.startsWith(THREAD_PREFIX) || contextId.startsWith(MSG_PREFIX)
        ? activeChannelId
        : null,
    );
    return () => setContextParentResolver(null);
  }, [activeChannelId, setContextParentResolver]);
  const {
    activeChannelTitle,
    activeDmAvatarUrl,
    activeDmHeaderParticipants,
    activeDmPresenceStatus,
    activeChannelEphemeralDisplay,
  } = useActiveChannelHeader(activeChannel, currentPubkey);
  const sendMessageMutation = useSendMessageMutation(
    activeChannel,
    currentIdentity,
  );
  const toggleReactionMutation = useToggleReactionMutation();
  const deleteMessageMutation = useDeleteMessageMutation(activeChannel);
  const editMessageMutation = useEditMessageMutation(activeChannel);
  const joinChannelMutation = useJoinChannelMutation(activeChannelId);
  const { resolvedMessages, threadSummaries } = useChannelResolvedMessages({
    activeChannel,
    messages: messagesQuery.data ?? EMPTY_RELAY_EVENTS,
    targetMessageEvents,
    windowStore: windowQuery.data,
  });
  const threadReplyEvents = threadRepliesQuery.data ?? EMPTY_RELAY_EVENTS;
  const {
    entranceMessageId: welcomeEntranceMessageId,
    handleEntranceComplete: handleWelcomeEntranceComplete,
    kickoffError,
    retryKickoff,
  } = useWelcomeKickoffEntrance(
    activeChannel,
    resolvedMessages,
    threadReplyEvents,
  );
  const messageEventProfilePubkeys = useMessageEventProfilePubkeys(
    resolvedMessages,
    threadReplyEvents,
    relaySelfPubkey,
  );
  const latestMessageEvent = React.useMemo(
    () => resolvedMessages[resolvedMessages.length - 1] ?? null,
    [resolvedMessages],
  );
  const typingEntries = useChannelTyping(
    activeChannel,
    currentPubkey,
    latestMessageEvent,
    relaySelfPubkey,
  );
  const activeDmParticipantPubkeys = React.useMemo(
    () =>
      activeChannel?.channelType === "dm"
        ? activeChannel.participantPubkeys
        : [],
    [activeChannel],
  );
  const channelMembersQuery = useChannelMembersQuery(activeChannel?.id ?? null);
  const channelMembers = channelMembersQuery.data;
  const managedAgentsQuery = useManagedAgentsQuery();
  const managedAgents = managedAgentsQuery.data ?? [];
  const relayAgentsQuery = useRelayAgentsQuery();
  const relayAgents = relayAgentsQuery.data ?? [];
  const knownAgentPubkeys = React.useMemo(
    () =>
      mergeChannelKnownAgentPubkeys(channelMembers, managedAgents, relayAgents),
    [channelMembers, managedAgents, relayAgents],
  );
  const messageProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...messageEventProfilePubkeys,
        ...activeDmParticipantPubkeys,
        ...knownAgentPubkeys,
        ...typingEntries.map((entry) => entry.pubkey),
      ]),
    ],
    [
      activeDmParticipantPubkeys,
      knownAgentPubkeys,
      messageEventProfilePubkeys,
      typingEntries,
    ],
  );
  const messageProfilesQuery = useUsersBatchQuery(messageProfilePubkeys, {
    enabled: messageProfilePubkeys.length > 0,
  });
  const {
    botTypingEntries,
    channelAgentSessionAgents,
    humanTypingPubkeys,
    threadTypingPubkeys,
  } = useChannelActivityTyping({
    activeChannel,
    activeChannelId,
    channelMembers,
    managedAgents,
    openThreadHeadId: effectiveOpenThreadHeadId,
    relayAgents,
    typingEntries,
  });
  const messageProfiles = useMessageProfiles({
    channelMembers,
    currentProfile,
    currentPubkey,
    managedAgents,
    profiles: messageProfilesQuery.data?.profiles,
    relayAgents,
  });
  const messageOwnerProfiles = useMessageOwnerProfiles(messageProfiles);
  const communityAgentPubkeys = useKnownAgentPubkeys();
  const agentPubkeys = React.useMemo(() => {
    const pubkeys = new Set([...communityAgentPubkeys, ...knownAgentPubkeys]);
    for (const [pubkey, profile] of Object.entries(messageProfiles)) {
      if (profile.isAgent) {
        pubkeys.add(normalizePubkey(pubkey));
      }
    }
    return pubkeys;
  }, [knownAgentPubkeys, messageProfiles, communityAgentPubkeys]);
  const personasQuery = usePersonasQuery();
  const { personaLookup, respondToLookup } = React.useMemo(() => {
    const agents = managedAgentsQuery.data ?? [];
    const personaById = new Map(
      (personasQuery.data ?? []).map((p) => [p.id, p.displayName]),
    );
    const pLookup = new Map<string, string>();
    const rLookup = new Map<string, RespondToMode>();
    for (const agent of agents) {
      const key = agent.pubkey.toLowerCase();
      rLookup.set(key, agent.respondTo);
      const pName = agent.personaId ? personaById.get(agent.personaId) : null;
      if (pName) pLookup.set(key, pName);
    }
    return { personaLookup: pLookup, respondToLookup: rLookup };
  }, [managedAgentsQuery.data, personasQuery.data]);
  const timelineMessages = React.useMemo(
    () =>
      formatTimelineMessages(
        resolvedMessages,
        activeChannel,
        currentPubkey,
        currentProfile?.avatarUrl ?? null,
        messageProfiles,
        channelMembers,
        personaLookup,
        respondToLookup,
        relaySelfPubkey,
        messageOwnerProfiles,
      ),
    [
      activeChannel,
      channelMembers,
      currentProfile?.avatarUrl,
      currentPubkey,
      messageProfiles,
      messageOwnerProfiles,
      personaLookup,
      relaySelfPubkey,
      respondToLookup,
      resolvedMessages,
    ],
  );
  const threadPanelData = useIndependentThreadPanel({
    activeChannel,
    channelEvents: resolvedMessages,
    threadReplyEvents,
    rootId: effectiveOpenThreadHeadId,
    replyTargetId: threadReplyTargetId,
    expandedReplyIds: expandedThreadReplyIds,
    currentPubkey,
    currentAvatarUrl: currentProfile?.avatarUrl ?? null,
    profiles: messageProfiles,
    ownerProfiles: messageOwnerProfiles,
    members: channelMembers,
    personaLookup,
    respondToLookup,
    relaySelfPubkey,
  });
  const {
    firstUnreadMessageId,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    handleMarkMessageRead,
    handleMarkMessageUnread,
    isMessageUnread,
    markRevealedRepliesRead,
    openThreadHeadMessage,
    threadFirstUnreadReplyId,
    threadReplyTargetMessage,
    threadReplyUnreadCounts,
    threadUnreadCounts,
    unreadCount,
  } = useChannelUnreadState({
    activeChannelId,
    timelineMessages,
    currentPubkey,
    openThreadHeadId: effectiveOpenThreadHeadId,
    threadReplyTargetId,
    expandedThreadReplyIds,
    openThreadMessages: threadPanelData.visibleReplies,
    clearChannelUnreadSource,
    getChannelReadAt,
    getMessageReadAt,
    markChannelUnread,
    markMessageRead,
    isThreadMuted,
    readStateVersion,
  });
  const editTargetMessage = React.useMemo(
    () =>
      timelineMessages.find((message) => message.id === editTargetId) ??
      threadPanelData.messages.find((message) => message.id === editTargetId) ??
      null,
    [editTargetId, threadPanelData.messages, timelineMessages],
  );
  const [emptyDeleteId, setEmptyDeleteId] = React.useState<string | null>(null);
  const {
    handleCancelEdit,
    handleCancelThreadReply,
    handleCloseThread,
    handleDelete,
    handleEdit,
    handleEditSave,
    handleExpandThreadReplies,
    handleOpenThread,
    requireThreadEditResolution,
    handleSendMessage,
    handleSendToChannel,
    handleSendThreadReply,
    handleSelectThreadReplyTarget,
    handleToggleReaction,
  } = useChannelPaneHandlers({
    deleteMessageMutation,
    editMessageMutation,
    editTargetId,
    editTargetIsThreadReply:
      editTargetMessage !== null && isThreadReply(editTargetMessage.tags ?? []),
    expandedThreadReplyIds,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    markRevealedRepliesRead,
    profiles: messageProfiles,
    recordThreadInteraction,
    openThreadHeadId: effectiveOpenThreadHeadId,
    onOptimisticOpenThreadHeadIdChange: setOptimisticOpenThreadHeadId,
    onRequestEmptyEditDelete: setEmptyDeleteId,
    sendMessageMutation,
    setExpandedThreadReplyIds,
    setEditTargetId,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    toggleReactionMutation,
  });
  const effectiveToggleReaction = React.useMemo(
    () =>
      activeChannel && !activeChannel.archivedAt && activeChannel.isMember
        ? handleToggleReaction
        : undefined,
    [activeChannel, handleToggleReaction],
  );
  const handleMessageMarkUnread = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageUnread(message.id),
    [handleMarkMessageUnread],
  );
  const handleMessageMarkRead = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageRead(message.id),
    [handleMarkMessageRead],
  );
  const sendMessageMutateAsync = sendMessageMutation.mutateAsync;
  const handleSendVideoReviewComment = React.useCallback(
    async (
      message: { id: string },
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      parentEventId?: string,
    ) => {
      await sendMessageMutateAsync({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId: parentEventId ?? message.id,
      });
    },
    [sendMessageMutateAsync],
  );
  const effectiveSendVideoReviewComment =
    activeChannel && !activeChannel.archivedAt && activeChannel.isMember
      ? handleSendVideoReviewComment
      : undefined;
  const handleOpenMembersSidebar = () => setIsMembersSidebarOpen(true);
  const handleCloseChannelManagement = () => setChannelManagementOpen(false);
  const handleChannelManagementDeleted = React.useCallback(() => {
    setChannelManagementOpen(false);
    void goHome({ replace: true });
  }, [setChannelManagementOpen, goHome]);
  const handleOpenThreadAndClosePanels = React.useCallback(
    (message: TimelineMessage) => {
      setProfilePanelPubkey(null);
      setChannelManagementOpen(false);
      handleOpenThread(message);
    },
    [handleOpenThread, setChannelManagementOpen, setProfilePanelPubkey],
  );
  const { handleOpenProfilePanel, handleCloseProfilePanel, handleOpenDm } =
    useChannelProfilePanel({
      openProfilePanel,
      requireThreadEditResolution,
      setChannelManagementOpen,
      setExpandedThreadReplyIds,
      setOpenThreadHeadId,
      setProfilePanelPubkey,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    });
  const settledChannelIdRef = React.useRef<string | null>(null);
  const { settledChannelId, isLoading: isTimelineLoading } =
    resolveTimelineQueryLoadingState(
      settledChannelIdRef.current,
      activeChannelId,
      {
        isEnabled: activeChannel !== null,
        isPending: messagesQuery.isPending,
        isFetching: messagesQuery.isFetching,
        isPlaceholderData: messagesQuery.isPlaceholderData,
        dataLength: messagesQuery.data?.length ?? null,
        isError: messagesQuery.isError,
      },
      activeChannelId !== null &&
        hasPersistedHydratedChannel(queryClient, activeChannelId),
    );
  settledChannelIdRef.current = settledChannelId;
  const { welcomeKickoffStage, welcomeKickoffSettingUp } =
    useWelcomeKickoffStagePresence(
      activeChannel,
      timelineMessages,
      isTimelineLoading,
    );
  useChannelTargetReset({
    activeChannelId,
    setEditTargetId,
    setExpandedThreadReplyIds,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
  });
  useNavigationGuard(requireThreadEditResolution);
  const mainTimelineTargetMessageId = useChannelRouteTarget({
    activeChannel,
    activeChannelId,
    requireThreadEditResolution,
    setEditTargetId,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    targetMessageId,
    timelineMessages,
  });
  useThreadTargetSync({
    clearOptimisticThreadOverride,
    editTargetId,
    editTargetMessage,
    isTimelineLoading,
    openThreadHeadId,
    openThreadHeadMessage,
    setEditTargetId,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    threadReplyTargetMessage,
  });
  const hasAuxiliaryPanel = Boolean(
    effectiveOpenThreadHeadId ||
      profilePanelPubkey ||
      channelManagementOpen,
  );
  const displayedThreadHeadMessage = threadPanelData.threadHead;
  const displayedThreadAllMessages = threadPanelData.messages;
  const displayedThreadMessages = threadPanelData.visibleReplies;
  const displayedThreadReplyTargetMessage = threadPanelData.replyTargetMessage;
  const displayedThreadFirstUnreadReplyId = displayedThreadHeadMessage
    ? threadFirstUnreadReplyId
    : null;
  const shouldShowThreadSkeleton = Boolean(
    effectiveOpenThreadHeadId && activeChannel && !displayedThreadHeadMessage,
  );
  const isNarrowPanelViewport =
    channelContentWidthPx > 0 &&
    channelContentWidthPx < CHANNEL_SINGLE_PANEL_CONTENT_BREAKPOINT_PX;
  const isSinglePanelView = isNarrowPanelViewport && hasAuxiliaryPanel;
  const shouldCompactHeaderActions =
    hasAuxiliaryPanel &&
    channelContentWidthPx > 0 &&
    channelContentWidthPx < 760;
  const referenceThreadPresentation = Boolean(effectiveOpenThreadHeadId);
  const referenceWorkspaceChannel =
    activeChannel?.channelType === "stream" && window.innerWidth >= 1440;
  const channelHeaderChromeRef = useMeasuredCssVariable({
    targetRef: mainInsetRef,
    ...channelContentTopPaddingMeasurement,
    resetKey: activeChannelId,
    enabled: !isSinglePanelView,
  });
  const handleManageChannel = React.useCallback(() => {
    if (!requireThreadEditResolution()) return;
    if (channelManagementOpen) {
      setChannelManagementOpen(false);
      return;
    }
    setOpenThreadHeadId(null);
    setExpandedThreadReplyIds(new Set());
    setThreadScrollTargetId(null);
    setThreadReplyTargetId(null);
    setProfilePanelPubkey(null);
    setChannelManagementOpen(true);
  }, [
    channelManagementOpen,
    requireThreadEditResolution,
    setChannelManagementOpen,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
  ]);
  const handleToggleMembers = React.useCallback(
    () => setIsMembersSidebarOpen((prev) => !prev),
    [],
  );
  const channelHeader = React.useMemo(
    () => (
      <ChannelScreenHeader
        activeChannel={activeChannel}
        activeChannelEphemeralDisplay={activeChannelEphemeralDisplay}
        activeChannelTitle={activeChannelTitle}
        referenceThreadPresentation={referenceThreadPresentation}
        actionsVariant={
          referenceThreadPresentation || referenceWorkspaceChannel
            ? "reference"
            : shouldCompactHeaderActions
              ? "compact"
              : "inline"
        }
        activeDmAvatarUrl={activeDmAvatarUrl}
        activeDmHeaderParticipants={activeDmHeaderParticipants}
        activeDmPresenceStatus={activeDmPresenceStatus}
        chromeWrapperRef={channelHeaderChromeRef}
        {...{ currentPubkey, headerEndActions }}
        isAddBotOpen={isAddBotOpen}
        isJoining={joinChannelMutation.isPending}
        members={channelMembers ?? EMPTY_CHANNEL_MEMBERS}
        onAddBotOpenChange={setIsAddBotOpen}
        onJoinChannel={joinChannelMutation.mutateAsync}
        onManageChannel={handleManageChannel}
        onToggleMembers={handleToggleMembers}
        showHeaderContent={!isSinglePanelView}
        transparentChrome
      />
    ),
    [
      activeChannel,
      activeChannelEphemeralDisplay,
      activeChannelTitle,
      referenceThreadPresentation,
      referenceWorkspaceChannel,
      shouldCompactHeaderActions,
      activeDmAvatarUrl,
      activeDmHeaderParticipants,
      activeDmPresenceStatus,
      channelHeaderChromeRef,
      currentPubkey,
      headerEndActions,
      isAddBotOpen,
      channelMembers,
      joinChannelMutation.isPending,
      joinChannelMutation.mutateAsync,
      handleManageChannel,
      handleToggleMembers,
      isSinglePanelView,
    ],
  );
  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
        <DeleteMessageConfirmDialog
          onConfirm={() => {
            if (emptyDeleteId) {
              setEditTargetId(null);
              void handleDelete({ id: emptyDeleteId });
            }
            setEmptyDeleteId(null);
          }}
          onOpenChange={(open) => {
            if (!open) setEmptyDeleteId(null);
          }}
          open={emptyDeleteId !== null}
        />
        <div className="colony-channel-route">
          {kickoffError ? (
            <div role="alert" data-testid="welcome-kickoff-recovery" className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm">
              <p>{kickoffError}</p>
              <button type="button" onClick={() => void goSettings("agents")}>Open AI settings</button>
              <button type="button" onClick={retryKickoff}>Retry</button>
            </div>
          ) : null}
          <WorkAreaLayout
            channel={
              activeChannel
                ? {
                    channelType: activeChannel.channelType,
                    isArchived: Boolean(activeChannel.archivedAt),
                    currentPubkey,
                    threadRootId: effectiveOpenThreadHeadId,
                  }
                : undefined
            }
            channelId={activeChannel?.id ?? null}
          >
          <div
            className="colony-channel-route-content"
            ref={channelContentRef}
          >
          {activeChannel ? (
              <React.Suspense
                fallback={<ViewLoadingFallback includeHeader kind="channel" />}
              >
                {searchForwarding.renderSearchAwareChannel(
                  <GuardedChannelPane
                  activeChannel={activeChannel}
                  activityAgents={channelAgentSessionAgents}
                  agentPubkeys={agentPubkeys}
                  autoSendDraftKey={autoSendDraftKey}
                  onAutoSendComplete={clearAutoSend}
                  botTypingEntries={botTypingEntries}
                  channelManagementOpen={channelManagementOpen}
                  currentPubkey={currentPubkey}
                  canResetThreadPanelWidth={canResetThreadPanelWidth}
                  fetchOlder={fetchOlder}
                  header={channelHeader}
                  {...{ idleAuxiliaryHeaderActions, idleAuxiliaryOverridesThread, idleAuxiliaryPanel, idleAuxiliaryTitle, hasOlderMessages, historyExhausted }}
                  onOpenMembers={handleOpenMembersSidebar}
                  isFetchingOlder={isFetchingOlder}
                  entranceMessageId={welcomeEntranceMessageId}
                  onEntranceMessageComplete={handleWelcomeEntranceComplete}
                  welcomeKickoffStage={kickoffError ? null : welcomeKickoffStage}
                  welcomeKickoffSettingUp={!kickoffError && welcomeKickoffSettingUp}
                  editTarget={
                    editTargetMessage
                      ? buildMessageComposerEditTarget(
                          editTargetMessage,
                          messageProfiles,
                          (pubkey) =>
                            knownAgentPubkeys.has(pubkey) ||
                            !!messageProfiles?.[pubkey]?.isAgent,
                        )
                      : null
                  }
                  followThreadById={followThread}
                  unfollowThreadById={unfollowThread}
                  isFollowingThreadById={isFollowingThread}
                  isMessageUnreadById={isMessageUnread}
                  isFollowingThread={isNotifiedForEffectiveThread}
                  isSending={sendMessageMutation.isPending}
                  isSinglePanelView={isSinglePanelView}
                  isTimelineError={messagesQuery.isError} isTimelineLoading={isTimelineLoading}
                  onRetryTimeline={() => void messagesQuery.refetch()} messages={timelineMessages}
                  threadSummaries={threadSummaries}
                  onCancelEdit={handleCancelEdit}
                  onCancelThreadReply={handleCancelThreadReply}
                  onChannelManagementDeleted={handleChannelManagementDeleted}
                  onFollowThread={
                    effectiveOpenThreadHeadId != null &&
                    !isNotifiedForEffectiveThread
                      ? () => followThread(effectiveOpenThreadHeadId)
                      : undefined
                  }
                  onUnfollowThread={
                    effectiveOpenThreadHeadId != null &&
                    isNotifiedForEffectiveThread
                      ? () => unfollowThread(effectiveOpenThreadHeadId)
                      : undefined
                  }
                  {...{ onCloseIdleAuxiliaryPanel }}
                  onCloseChannelManagement={handleCloseChannelManagement}
                  onCloseThread={handleCloseThread}
                  onDelete={
                    activeChannel?.archivedAt ? undefined : handleDelete
                  }
                  onEdit={activeChannel?.archivedAt ? undefined : handleEdit}
                  onEditSave={
                    activeChannel?.archivedAt ? undefined : handleEditSave
                  }
                  onMarkUnread={handleMessageMarkUnread}
                  onMarkRead={handleMessageMarkRead}
                  onExpandThreadReplies={handleExpandThreadReplies}
                  onOpenDm={handleOpenDm}
                  onOpenProfilePanel={handleOpenProfilePanel}
                  onResetThreadPanelWidth={handleThreadPanelWidthReset}
                  onCloseProfilePanel={handleCloseProfilePanel}
                  onOpenThread={handleOpenThreadAndClosePanels}
                  onSelectThreadReplyTarget={handleSelectThreadReplyTarget}
                  onSendMessage={handleSendMessage}
                  onSendToChannel={handleSendToChannel}
                  onSendVideoReviewComment={effectiveSendVideoReviewComment}
                  onSendThreadReply={handleSendThreadReply}
                  onThreadScrollTargetResolved={() =>
                    setThreadScrollTargetId(null)
                  }
                  onThreadPanelResizeStart={handleThreadPanelResizeStart}
                  onTargetReached={() =>
                    clearMessageRouteTarget({ replace: true })
                  }
                  onToggleReaction={effectiveToggleReaction}
                  openThreadHeadId={effectiveOpenThreadHeadId}
                  shouldShowThreadSkeleton={shouldShowThreadSkeleton}
                  onProfilePanelViewChange={setProfilePanelView}
                  onProfilePanelTabChange={setProfilePanelTab}
                  profilePanelPubkey={profilePanelPubkey}
                  profilePanelTab={profilePanelTab}
                  profilePanelView={profilePanelView}
                  personaLookup={personaLookup}
                  profiles={messageProfiles}
                  ownerProfiles={messageOwnerProfiles}
                  firstUnreadMessageId={firstUnreadMessageId}
                  unreadCount={unreadCount}
                  targetMessageId={mainTimelineTargetMessageId}
                  threadAllMessages={displayedThreadAllMessages}
                  threadHeadMessage={displayedThreadHeadMessage}
                  threadMessages={displayedThreadMessages}
                  threadMessagesPending={threadRepliesQuery.isPending}
                  threadMessagesError={threadRepliesQuery.isError}
                  onRetryThreadReplies={() => {
                    void threadRepliesQuery.refetch();
                  }}
                  threadPanelWidthPx={threadPanelWidthPx}
                  threadTypingPubkeys={threadTypingPubkeys}
                  threadReplyTargetMessage={displayedThreadReplyTargetMessage}
                  threadScrollTargetId={threadScrollTargetId}
                  threadUnreadCounts={threadUnreadCounts}
                  threadReplyUnreadCounts={threadReplyUnreadCounts}
                  threadFirstUnreadReplyId={displayedThreadFirstUnreadReplyId}
                  isJoining={joinChannelMutation.isPending}
                  onJoinChannel={joinChannelMutation.mutateAsync}
                    typingPubkeys={humanTypingPubkeys}
                  />,
                  searchTarget,
                )}
              </React.Suspense>
          ) : (
            <ChannelScreenEmptyState />
          )}
          </div>
          </WorkAreaLayout>
        <MembersSidebar
          channel={activeChannel}
          currentPubkey={currentPubkey}
          open={isMembersSidebarOpen}
          onOpenChange={setIsMembersSidebarOpen}
          relayUrl={activeCommunity?.relayUrl}
        />
        </div>
    </ProfilePanelProvider>
  );
}
