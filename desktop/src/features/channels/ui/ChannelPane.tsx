import * as React from "react";
import { Lock, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useClientRecordsQuery } from "@/features/clients/useBusinessRecords";
import { parseWorkItemReferenceCoordinate } from "@/features/clients/lib/businessRecords";
import { WorkItemReferenceContext } from "@/features/clients/ui/WorkItemReferenceContext";
import { useMediaUpload } from "@/features/messages/lib/useMediaUpload";
import { ComposerDockBackdrop } from "@/features/messages/ui/ComposerDockBackdrop";
import { ComposerUploadProgressOverlay } from "@/features/messages/ui/ComposerUploadProgressOverlay";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { ComposerTimeoutBanner } from "@/features/moderation/ui/ComposerTimeoutBanner";
import { useTimeoutState } from "@/features/moderation/lib/timeoutStore";
import { isModerationDm } from "@/features/moderation/lib/moderationDm";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { DropZoneOverlay } from "@/features/messages/ui/ComposerAttachments";
import { MessageThreadPanel } from "@/features/messages/ui/MessageThreadPanel";
import { MessageThreadPanelSkeleton } from "@/features/messages/ui/MessageThreadPanelSkeleton";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "@/features/messages/ui/MessageTimeline";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { buildVideoReviewPresentationByMessageId } from "@/features/messages/lib/videoReviewContext";
import { useComposerHeightPadding } from "@/features/messages/ui/useComposerHeightPadding";
import { UserProfilePanel } from "@/features/profile/ui/UserProfilePanel";
import { ChannelManagementAuxiliaryPanel } from "@/features/channels/ui/ChannelManagementAuxiliaryPanel";
import { IdleAuxiliaryPanel } from "@/features/channels/ui/IdleAuxiliaryPanel";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import {
  ThreadPanelSurface,
  useThreadPanelSurface,
} from "@/features/channels/ui/ThreadPanelSurface";
import { ThreadViewModeToggle } from "@/features/channels/ui/ThreadViewModeToggle";
import { FocusThreadDrawer } from "@/features/channels/ui/FocusThreadDrawer";
import { THREAD_SURFACE_KEY } from "@/features/channels/lib/threadFocusLayout";
import { getThreadPanelLayout } from "@/features/channels/lib/threadPanelLayout";
import { useThreadViewMode } from "@/features/channels/lib/threadViewModePreference";
import { useThreadViewModeSwitch } from "@/features/channels/ui/useThreadViewModeSwitch";
import { useFocusDrawerPresence } from "@/features/channels/ui/useFocusDrawerPresence";
import { useCardMintJobs } from "@/features/agents/cardMintStore";
import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import { AgentWorkingIndicatorRow } from "@/features/channels/ui/AgentWorkingIndicator";
import { useAgentWorkingIndicators } from "@/features/channels/ui/useAgentWorkingIndicators";
import { formatWorkingIndicatorLabel } from "@/features/channels/lib/agentWorkingIndicator";
import { ChannelComposerActivityAccessory } from "@/features/channels/ui/ChannelComposerActivityAccessory";
import {
  containsWelcomePersonaMention,
  WelcomeComposerGuidanceLayer,
} from "@/features/channels/ui/WelcomeComposerBanner";
import { useWelcomeComposerBanner } from "@/features/channels/ui/useWelcomeComposerBanner";
import {
  mentionsKnownAgent,
  shouldPrioritizeIdleAuxiliary,
  shouldUseFocusIdleDrawer,
} from "@/features/channels/ui/ChannelPane.helpers";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { JoinGlyph } from "@/shared/ui/conversationIcons";
import { useSearchHighlightProps } from "@/features/channels/ui/useSearchHighlightProps";
import type { ChannelPaneProps } from "@/features/channels/ui/ChannelPane.types";
import { usePrepareDmSendChannel } from "@/features/channels/ui/usePrepareDmSendChannel";
import { useChannelPaneMessages } from "@/features/channels/ui/useChannelPaneMessages";
import { useRoutedMessageEdit } from "@/features/channels/ui/useRoutedMessageEdit";
import { Button } from "@/shared/ui/button";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { useRenderScopedReactionHydration } from "@/features/messages/lib/useRenderScopedReactionHydration";
import { isWelcomeExperienceChannel as isWelcomeExperience } from "@/features/onboarding/welcome";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
const NO_ACTIVITY_AGENTS: BotActivityAgent[] = [];
export const ChannelPane = React.memo(function ChannelPane({
  activeChannel,
  agentPubkeys,
  activityAgents = NO_ACTIVITY_AGENTS,
  botTypingEntries,
  autoSendDraftKey = null,
  onAutoSendComplete = null,
  channelManagementOpen = false,
  currentPubkey,
  editTarget = null,
  fetchOlder,
  header,
  idleAuxiliaryPanel = null,
  idleAuxiliaryHeaderActions,
  idleAuxiliaryOverridesThread = false,
  idleAuxiliaryTitle = "",
  hasOlderMessages,
  historyExhausted,
  isFetchingOlder,
  followThreadById,
  isFollowingThread,
  isFollowingThreadById,
  isMessageUnreadById,
  isJoining = false,
  isSinglePanelView = false,
  isSending,
  isTimelineError = false,
  isTimelineLoading,
  onRetryTimeline,
  entranceMessageId = null,
  onEntranceMessageComplete,
  welcomeKickoffStage = null,
  welcomeKickoffSettingUp = false,
  messages,
  threadSummaries,
  firstUnreadMessageId = null,
  unreadCount = 0,
  canResetThreadPanelWidth,
  onCancelEdit,
  onCancelThreadReply,
  onCloseChannelManagement,
  onChannelManagementDeleted,
  onCloseIdleAuxiliaryPanel,
  onCloseProfilePanel,
  onCloseThread,
  onDelete,
  onEdit,
  onEditSave,
  onFollowThread,
  onMarkUnread,
  onMarkRead,
  onExpandThreadReplies,
  onJoinChannel,
  onOpenDm,
  onOpenMembers,
  onOpenProfilePanel,
  onOpenThread,
  onResetThreadPanelWidth,
  onSelectThreadReplyTarget,
  onSendMessage,
  onSendToChannel,
  onSendVideoReviewComment,
  onSendThreadReply,
  onThreadScrollTargetResolved,
  onThreadPanelResizeStart,
  onTargetReached,
  onToggleReaction,
  onUnfollowThread,
  unfollowThreadById,
  personaLookup,
  profiles,
  ownerProfiles,
  openThreadHeadId,
  shouldShowThreadSkeleton,
  onProfilePanelViewChange,
  onProfilePanelTabChange,
  profilePanelPubkey,
  profilePanelTab,
  profilePanelView,
  targetMessageId,
  targetSearchMessageId,
  targetSearchQuery,
  threadAllMessages,
  threadHeadMessage,
  threadMessages,
  threadMessagesPending = false,
  threadMessagesError = false,
  onRetryThreadReplies,
  threadPanelWidthPx,
  threadScrollTargetId,
  threadTypingPubkeys,
  threadReplyTargetMessage,
  threadUnreadCounts,
  threadReplyUnreadCounts,
  threadFirstUnreadReplyId,
  typingPubkeys,
}: ChannelPaneProps) {
  const timelineScrollRef = React.useRef<HTMLDivElement>(null);
  const messageTimelineRef = React.useRef<MessageTimelineHandle>(null);
  const composerWrapperRef = React.useRef<HTMLDivElement>(null);
  const { goChannel } = useAppNavigation();
  const navigate = useNavigate();
  const prepareDmSendChannel = usePrepareDmSendChannel(
    activeChannel,
    currentPubkey,
  );
  const mainComposerMedia = useMediaUpload({ deferUploadsUntilSend: true });
  const searchHighlightProps = useSearchHighlightProps(
    targetSearchMessageId,
    targetSearchQuery,
  );
  const [isMainDeferredEditPending, setMainDeferredEditPending] =
    React.useState(false);
  const [acceptsMainAttachments, setAcceptsMainAttachments] =
    React.useState(true);
  const isNonMemberView =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt;
  const hasMainComposerOverlay = !isNonMemberView;
  const activeChannelId = activeChannel?.id ?? null;
  const activeChannelIdRef = React.useRef(activeChannelId);
  const channelPaneMountedRef = React.useRef(false);
  activeChannelIdRef.current = activeChannelId;
  React.useEffect(() => {
    channelPaneMountedRef.current = true;
    return () => {
      channelPaneMountedRef.current = false;
    };
  }, []);
  const handleAutoSubmitComplete = React.useCallback(() => {
    if (onAutoSendComplete) {
      onAutoSendComplete();
    } else if (activeChannelId) {
      void goChannel(activeChannelId, { replace: true });
    }
  }, [activeChannelId, goChannel, onAutoSendComplete]);
  const isActiveWelcomeChannel =
    activeChannel !== null && isWelcomeExperience(activeChannel);
  useComposerHeightPadding(
    timelineScrollRef,
    composerWrapperRef,
    `${activeChannelId}:${isSinglePanelView}:${hasMainComposerOverlay}`,
    "css-variable",
    () => messageTimelineRef.current?.settleAtBottom() ?? false,
  );
  const {
    bannerState: welcomeComposerBannerState,
    completeBanner: completeWelcomeComposerBanner,
    dismissBanner: handleDismissWelcomeBanner,
  } = useWelcomeComposerBanner(
    activeChannelId,
    isActiveWelcomeChannel,
    currentPubkey ?? null,
  );
  const isEditInThread = editTarget?.isThreadReply === true;
  const mainEditTarget = editTarget && !isEditInThread ? editTarget : null;
  const threadEditTarget = editTarget && isEditInThread ? editTarget : null;
  const timeoutState = useTimeoutState();
  const relaySelfQuery = useRelaySelfQuery(activeChannel?.channelType === "dm");
  const isModerationDmChannel = isModerationDm(
    activeChannel ?? null,
    currentPubkey,
    relaySelfQuery.data,
  );
  const isComposerDisabled =
    !activeChannel?.isMember ||
    activeChannel.archivedAt !== null ||
    timeoutState.active ||
    isModerationDmChannel ||
    isSending;
  const knownAgentPubkeys = React.useMemo(() => {
    const pubkeys = new Set<string>();
    for (const pubkey of agentPubkeys ?? []) {
      pubkeys.add(pubkey.toLowerCase());
    }
    for (const agent of activityAgents) {
      pubkeys.add(agent.pubkey.toLowerCase());
    }
    return pubkeys;
  }, [activityAgents, agentPubkeys]);
  const handleSendMessage = React.useCallback(
    async (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      channelId?: string | null,
      threadContext?: {
        parentEventId: string | null;
        threadHeadId: string | null;
      } | null,
      forceRest?: boolean,
    ) => {
      const shouldCompleteWelcomeBanner =
        isActiveWelcomeChannel &&
        (containsWelcomePersonaMention(content) ||
          mentionsKnownAgent(mentionPubkeys, knownAgentPubkeys));
      messageTimelineRef.current?.scrollToBottomOnNextUpdate();
      await onSendMessage(
        content,
        mentionPubkeys,
        mediaTags,
        channelId,
        threadContext,
        forceRest,
      );
      if (
        channelId &&
        channelId !== activeChannelId &&
        channelPaneMountedRef.current &&
        activeChannelIdRef.current === activeChannelId
      ) {
        await goChannel(channelId, { replace: true });
      }
      if (shouldCompleteWelcomeBanner) {
        completeWelcomeComposerBanner();
      }
    },
    [
      activeChannelId,
      completeWelcomeComposerBanner,
      goChannel,
      isActiveWelcomeChannel,
      knownAgentPubkeys,
      onSendMessage,
    ],
  );
  const canDropInMainColumn =
    hasMainComposerOverlay &&
    !isComposerDisabled &&
    !isMainDeferredEditPending &&
    acceptsMainAttachments &&
    !isSinglePanelView;
  const hasTypingActivity = typingPubkeys.length > 0;
  const agentNames = React.useMemo(
    () =>
      new Map(
        activityAgents.map((agent) => [agent.pubkey.toLowerCase(), agent.name]),
      ),
    [activityAgents],
  );
  const { channel: channelWorkingIndicator, thread: threadWorkingIndicator } =
    useAgentWorkingIndicators({
      agentNames,
      botTypingEntries,
      channelId: activeChannel?.id ?? null,
      channelMessages: messages,
      currentPubkey,
      openThreadHeadId: openThreadHeadId ?? null,
      profiles,
      threadMessages: threadAllMessages,
    });
  const hasComposerBotActivity = channelWorkingIndicator.kind !== "hidden";
  const hasCardMintActivity = useCardMintJobs().length > 0;
  const hasComposerBottomActivity =
    hasComposerBotActivity || hasTypingActivity || hasCardMintActivity;
  const hasThreadComposerBotActivity = threadWorkingIndicator.kind !== "hidden";
  const directMessageIntro = React.useMemo(
    () =>
      buildDirectMessageIntro({
        channel: activeChannel,
        currentPubkey,
        profiles,
      }),
    [activeChannel, currentPubkey, profiles],
  );
  const hasOpenMessageThread = Boolean(openThreadHeadId || threadHeadMessage);
  const workspaceChrome = window.innerWidth >= 1440;
  const {
    mainTimelineEntries: channelTimelineEntries,
    recentMentions,
    visibleMessages: channelVisibleMessages,
  } = useChannelPaneMessages({
    activeChannel,
    messages,
    profiles,
    threadSummaries,
  });
  const threadContextRootId = threadHeadMessage?.body
    .trimStart()
    .match(/^#{1,3}\s/u)
    ? threadHeadMessage.id
    : null;
  const mainTimelineEntries = React.useMemo(
    () =>
      threadContextRootId
        ? channelTimelineEntries.filter(
            (entry) => entry.message.id !== threadContextRootId,
          )
        : channelTimelineEntries,
    [channelTimelineEntries, threadContextRootId],
  );
  const visibleMessages = React.useMemo(
    () =>
      threadContextRootId
        ? channelVisibleMessages.filter(
            (message) => message.id !== threadContextRootId,
          )
        : channelVisibleMessages,
    [channelVisibleMessages, threadContextRootId],
  );
  const latestVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const askThreadRootEventId =
    threadHeadMessage?.id ??
    latestVisibleMessage?.rootId ??
    latestVisibleMessage?.id ??
    null;
  const hasWorkItemReference = React.useMemo(() => {
    if (!activeChannelId) return false;
    const messagesWithThreadReplies = [
      ...visibleMessages,
      ...threadMessages.map((entry) => entry.message),
    ];
    return messagesWithThreadReplies.some((message) => {
      const channelTags = message.tags?.filter((tag) => tag[0] === "h") ?? [];
      const referenceTags = message.tags?.filter((tag) => tag[0] === "a") ?? [];
      return (
        message.kind === KIND_STREAM_MESSAGE &&
        message.body.trim() === "" &&
        channelTags.length === 1 &&
        referenceTags.length === 1 &&
        channelTags[0]?.[1]?.toLowerCase() === activeChannelId.toLowerCase() &&
        parseWorkItemReferenceCoordinate(
          referenceTags[0]?.[1] ?? "",
          activeChannelId,
        ) !== null
      );
    });
  }, [activeChannelId, threadMessages, visibleMessages]);
  const workReferenceRecordsQuery = useClientRecordsQuery(
    activeChannelId,
    hasWorkItemReference,
  );
  const workReferenceContext = React.useMemo(
    () => ({
      channelId: activeChannelId,
      records: workReferenceRecordsQuery.workItemsQuery.data ?? [],
    }),
    [activeChannelId, workReferenceRecordsQuery.workItemsQuery.data],
  );
  useRenderScopedReactionHydration({
    activeChannel,
    mainTimelineEntries,
    threadHeadMessage,
    threadMessages,
  });
  const activeVideoReviewCommentSender = activeChannel?.archivedAt
    ? undefined
    : onSendVideoReviewComment;
  const threadVideoReviewPresentation = React.useMemo(() => {
    const messagesById = new Map(
      messages.map((message) => [message.id, message]),
    );
    if (threadHeadMessage) {
      messagesById.set(threadHeadMessage.id, threadHeadMessage);
    }
    for (const message of threadAllMessages) {
      messagesById.set(message.id, message);
    }
    return buildVideoReviewPresentationByMessageId({
      channelId: activeChannel?.id ?? null,
      channelName: activeChannel?.name,
      channelType: activeChannel?.channelType ?? null,
      isSendingVideoReviewComment: isSending,
      messages: [...messagesById.values()],
      onSendVideoReviewComment: activeVideoReviewCommentSender,
      onToggleReaction,
      profiles,
    });
  }, [
    activeChannel,
    activeVideoReviewCommentSender,
    isSending,
    messages,
    onToggleReaction,
    profiles,
    threadAllMessages,
    threadHeadMessage,
  ]);
  const isOverlay = useIsThreadPanelOverlay();
  const useSplitAuxiliaryPane = !isSinglePanelView && !isOverlay;
  const threadViewMode = useThreadViewMode();
  const hasThreadSurface =
    Boolean(threadHeadMessage) || shouldShowThreadSkeleton;
  const useFocusThreadDrawer =
    hasThreadSurface &&
    (isOverlay || (threadViewMode === "focus" && useSplitAuxiliaryPane));
  const hasIdleAuxiliary =
    Boolean(idleAuxiliaryPanel) && Boolean(onCloseIdleAuxiliaryPanel);
  const priorityIdleAuxiliary = shouldPrioritizeIdleAuxiliary(
    idleAuxiliaryOverridesThread,
    hasIdleAuxiliary,
  );
  const overlayIdleAuxiliaryOverThread =
    priorityIdleAuxiliary && hasThreadSurface && !isOverlay;
  const replaceThreadWithIdleAuxiliary =
    priorityIdleAuxiliary && hasThreadSurface && isOverlay;
  const useFocusIdleDrawer = shouldUseFocusIdleDrawer({
    channelManagementOpen,
    hasIdleAuxiliaryPanel: Boolean(idleAuxiliaryPanel),
    hasIdlePanelCloseHandler: Boolean(onCloseIdleAuxiliaryPanel),
    hasProfilePanel: Boolean(profilePanelPubkey),
    hasThreadSurface,
    overrideThread: overlayIdleAuxiliaryOverThread,
    useSplitAuxiliaryPane,
  });
  const showIdleAuxiliaryOverThread =
    overlayIdleAuxiliaryOverThread && useFocusIdleDrawer;
  const { channelIsCovered, markExitComplete } = useFocusDrawerPresence(
    useFocusThreadDrawer || useFocusIdleDrawer,
    priorityIdleAuxiliary
      ? (onCloseIdleAuxiliaryPanel ?? onCloseThread)
      : useFocusThreadDrawer
        ? onCloseThread
        : (onCloseIdleAuxiliaryPanel ?? onCloseThread),
  );
  const threadSurface = useThreadPanelSurface(
    showIdleAuxiliaryOverThread,
    markExitComplete,
  );
  const { changeThreadViewMode, layoutScrollTargetId, resolveScrollTarget } =
    useThreadViewModeSwitch({
      activeThreadHeadId: threadHeadMessage?.id ?? null,
      externalScrollTargetId: threadScrollTargetId,
      onExternalTargetResolved: onThreadScrollTargetResolved,
      onModeChange: markExitComplete,
    });
  const {
    handleEditLastOwnMainMessage,
    handleEditLastOwnThreadMessage,
    routeEdit: handleRoutedEdit,
  } = useRoutedMessageEdit({
    activeChannelId,
    channelIsCovered,
    currentPubkey,
    editTarget,
    isSinglePanelView,
    mainMessages: mainTimelineEntries.map((entry) => entry.message),
    onCloseThread,
    onEdit,
    threadHeadMessage,
    threadMessages: threadMessages.map((entry) => entry.message),
    useFocusThreadDrawer,
  });
  const hasSplitAuxiliaryPane =
    useSplitAuxiliaryPane &&
    (channelManagementOpen ||
      Boolean(threadHeadMessage) ||
      shouldShowThreadSkeleton ||
      Boolean(profilePanelPubkey));
  const wrapAux = (
    panel: React.ReactNode,
    testId: string,
    options: { key?: string } = {},
  ) =>
    useSplitAuxiliaryPane ? (
      <RightAuxiliaryPane
        canResetWidth={canResetThreadPanelWidth}
        key={options.key ?? testId}
        onResetWidth={onResetThreadPanelWidth}
        onResizeStart={onThreadPanelResizeStart}
        testId={testId}
        widthPx={threadPanelWidthPx}
      >
        {panel}
      </RightAuxiliaryPane>
    ) : (
      <React.Fragment key={options.key ?? testId}>{panel}</React.Fragment>
    );
  const wrapThreadPanel = (panel: React.ReactNode) => (
    <ThreadPanelSurface
      channelName={activeChannel?.name ?? "channel"}
      covered={threadSurface.covered}
      hasActiveEdit={threadEditTarget !== null}
      isFocusDrawer={useFocusThreadDrawer}
      responsiveOverlay={isOverlay}
      restoreFocusOnDismiss={isOverlay}
      key={THREAD_SURFACE_KEY}
      onClose={onCloseThread}
      ref={threadSurface.ref}
    >
      {useFocusThreadDrawer ? panel : wrapAux(panel, "message-thread-panel")}
    </ThreadPanelSurface>
  );
  const wrapIdlePanel = (panel: React.ReactNode) =>
    useFocusIdleDrawer && onCloseIdleAuxiliaryPanel ? (
      <FocusThreadDrawer
        channelName={activeChannel?.name ?? "channel"}
        key="idle-auxiliary-surface"
        label={idleAuxiliaryTitle || "Panel"}
        onClose={onCloseIdleAuxiliaryPanel}
        restoreFocusTarget={threadSurface.restoreFocusTarget}
      >
        {panel}
      </FocusThreadDrawer>
    ) : (
      wrapAux(panel, "idle-auxiliary-panel")
    );
  const idleAuxiliarySurface =
    idleAuxiliaryPanel && onCloseIdleAuxiliaryPanel
      ? wrapIdlePanel(
          <IdleAuxiliaryPanel
            canResetWidth={canResetThreadPanelWidth}
            headerControls={idleAuxiliaryHeaderActions}
            isFocusDrawer={useFocusIdleDrawer}
            isSinglePanelView={isSinglePanelView}
            onClose={onCloseIdleAuxiliaryPanel}
            onResetWidth={onResetThreadPanelWidth}
            onResizeStart={onThreadPanelResizeStart}
            title={idleAuxiliaryTitle}
            useSplitAuxiliaryPane={useSplitAuxiliaryPane}
            widthPx={threadPanelWidthPx}
          >
            {idleAuxiliaryPanel}
          </IdleAuxiliaryPanel>,
        )
      : null;
  const threadHeaderLeading = useSplitAuxiliaryPane ? (
    <ThreadViewModeToggle onChange={changeThreadViewMode} />
  ) : undefined;
  const threadLayoutProps = getThreadPanelLayout({
    headerLeading: threadHeaderLeading,
    headerChannelPrivate: activeChannel?.visibility === "private",
    headerTitleSuffix: activeChannel ? `# ${activeChannel.name}` : undefined,
    isFocusDrawer: useFocusThreadDrawer,
    isSinglePanelView,
    useSplitAuxiliaryPane,
  });
  const timelineReplyHandler = activeChannel?.archivedAt
    ? undefined
    : onOpenThread;
  return (
    <WorkItemReferenceContext.Provider value={workReferenceContext}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {!isSinglePanelView ? (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-30 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55",
              channelChrome.headerHeight,
            )}
            data-testid="channel-shared-header-backdrop"
          />
        ) : null}
        {!isSinglePanelView ? (
          <section
            aria-label="Channel messages and composer"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            inert={channelIsCovered ? true : undefined}
            data-testid="channel-drop-zone"
            onDragEnter={
              canDropInMainColumn
                ? mainComposerMedia.handleDragEnter
                : undefined
            }
            onDragLeave={
              canDropInMainColumn
                ? mainComposerMedia.handleDragLeave
                : undefined
            }
            onDragOver={
              canDropInMainColumn ? mainComposerMedia.handleDragOver : undefined
            }
            onDrop={
              canDropInMainColumn
                ? (event) => {
                    void mainComposerMedia.handleDrop(event);
                  }
                : undefined
            }
          >
            {header}
            <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
              <MessageTimeline
                ref={messageTimelineRef}
                channelId={activeChannel?.id}
                activeThreadRootId={
                  workspaceChrome ? (threadHeadMessage?.id ?? null) : null
                }
                scrollContainerRef={timelineScrollRef}
                currentPubkey={currentPubkey}
                fetchOlder={fetchOlder}
                followThreadById={followThreadById}
                hasComposerOverlay={hasMainComposerOverlay}
                hasOlderMessages={hasOlderMessages}
                historyExhausted={historyExhausted}
                alwaysShowMessageIdentity={
                  workspaceChrome && hasOpenMessageThread
                }
                compactThreadSummaryAvatars
                isFetchingOlder={isFetchingOlder}
                isFollowingThreadById={isFollowingThreadById}
                isMessageUnreadById={isMessageUnreadById}
                personaLookup={personaLookup}
                profiles={profiles}
                ownerProfiles={ownerProfiles}
                unfollowThreadById={unfollowThreadById}
                emptyTitle={
                  activeChannel ? "No messages yet" : "No channel selected"
                }
                isError={isTimelineError}
                isLoading={isTimelineLoading}
                onRetry={onRetryTimeline}
                entranceMessageId={entranceMessageId}
                onEntranceMessageComplete={onEntranceMessageComplete}
                mainEntries={mainTimelineEntries}
                threadSummaries={threadSummaries}
                messages={visibleMessages}
                firstUnreadMessageId={firstUnreadMessageId}
                unreadCount={unreadCount}
                onDelete={onDelete}
                onEdit={handleRoutedEdit}
                onMarkUnread={onMarkUnread}
                onMarkRead={onMarkRead}
                onReply={timelineReplyHandler}
                onOpenThread={onOpenThread}
                channelName={activeChannel?.name}
                channelType={activeChannel?.channelType ?? null}
                isSendingVideoReviewComment={isSending}
                onSendVideoReviewComment={
                  activeChannel?.archivedAt
                    ? undefined
                    : onSendVideoReviewComment
                }
                onTargetReached={onTargetReached}
                onToggleReaction={onToggleReaction}
                {...searchHighlightProps.timeline}
                targetMessageId={targetMessageId}
                splitThreadPanelOpen={
                  useSplitAuxiliaryPane &&
                  !useFocusThreadDrawer &&
                  Boolean(openThreadHeadId)
                }
                threadUnreadCounts={threadUnreadCounts}
              />
              {isNonMemberView ? (
                <div
                  data-testid="join-banner"
                  className="flex flex-wrap items-center gap-3.5 border-t border-colony-border bg-[#fbf8f6] px-7 py-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 text-colony-muted">
                    {activeChannel ? (
                      <ChannelGlyph
                        channel={activeChannel}
                        className="!size-[calc(18*var(--colony-px))] shrink-0"
                      />
                    ) : null}
                    <span className="c3c-join-viewing truncate">
                      Viewing{" "}
                      <strong className="font-extrabold text-colony-fg">
                        #{activeChannel?.name}
                      </strong>
                    </span>
                  </div>
                  <button
                    className="c3c-join-button inline-flex items-center gap-2 rounded-xl bg-colony-accent px-5 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    disabled={isJoining}
                    onClick={() => {
                      void onJoinChannel?.();
                    }}
                    type="button"
                  >
                    <JoinGlyph size={17} />
                    {isJoining ? "Joining..." : "Join to participate"}
                  </button>
                </div>
              ) : activeChannel?.archivedAt ? (
                <div
                  className="border-t border-colony-border px-7 py-4"
                  data-testid="archived-banner"
                >
                  <div className="c3c-archived-bar flex items-center gap-2.5 rounded-2xl bg-colony-wash px-4 py-3.5 text-colony-muted">
                    <Lock aria-hidden="true" className="size-4 shrink-0" />
                    <span>Archived channels are read-only.</span>
                  </div>
                </div>
              ) : (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-24 before:bg-gradient-to-b before:from-transparent before:to-background before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-12 after:bg-background after:content-['']"
                  data-testid="channel-composer-overlay"
                  ref={composerWrapperRef}
                >
                  <ComposerUploadProgressOverlay />
                  <div
                    className={cn(
                      "composer-dock composer-overlay-corner-masks relative pointer-events-auto",
                      hasComposerBottomActivity &&
                        "composer-dock--with-activity",
                    )}
                  >
                    {isActiveWelcomeChannel && !timeoutState.active ? (
                      <WelcomeComposerGuidanceLayer
                        onDismiss={handleDismissWelcomeBanner}
                        settingUp={welcomeKickoffSettingUp}
                        state={welcomeComposerBannerState}
                      >
                        {welcomeKickoffStage}
                      </WelcomeComposerGuidanceLayer>
                    ) : null}
                    <ComposerDockBackdrop gutterClassName="inset-x-5" />
                    <MessageComposer
                      channelId={activeChannel?.id ?? null}
                      channelName={activeChannel?.name ?? "channel"}
                      channelType={activeChannel?.channelType ?? null}
                      containerClassName="px-5 pb-0"
                      layoutMode="dock"
                      workspaceChrome={workspaceChrome}
                      disabled={isComposerDisabled}
                      editTarget={mainEditTarget}
                      autoSubmitDraftKey={autoSendDraftKey}
                      onAutoSubmitComplete={handleAutoSubmitComplete}
                      isSending={isSending}
                      mediaController={mainComposerMedia}
                      onAttachmentAcceptanceChange={setAcceptsMainAttachments}
                      onDeferredEditPendingChange={setMainDeferredEditPending}
                      onCancelEdit={onCancelEdit}
                      onEditLastOwnMessage={handleEditLastOwnMainMessage}
                      onEditSave={onEditSave}
                      onPrepareSendChannel={
                        activeChannel?.channelType === "dm"
                          ? prepareDmSendChannel
                          : undefined
                      }
                      onSend={handleSendMessage}
                      {...{ profiles, recentMentionPubkeys: recentMentions }}
                      showBackgroundUploadProgress={false}
                      statusBanner={
                        timeoutState.active ? (
                          <ComposerTimeoutBanner
                            expiresAtMs={timeoutState.expiresAtMs}
                          />
                        ) : undefined
                      }
                      toolbarAskAction={
                        activeChannel?.channelType === "stream" ? (
                          <Button
                            className="colony-ask-entry-button"
                            data-testid="raise-ask-from-composer"
                            disabled={!activeChannelId || !askThreadRootEventId}
                            onClick={() => {
                              if (!activeChannelId || !askThreadRootEventId)
                                return;
                              void navigate({
                                to: "/asks/new",
                                search: {
                                  channelId: activeChannelId,
                                  threadRootEventId: askThreadRootEventId,
                                },
                              });
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Plus aria-hidden="true" />
                            Raise an ask
                          </Button>
                        ) : undefined
                      }
                      placeholder={
                        timeoutState.active
                          ? "You're timed out by community moderators."
                          : isModerationDmChannel
                            ? "This channel is read-only."
                            : activeChannel?.archivedAt
                              ? "Archived channels are read-only."
                              : activeChannel
                                ? activeChannel.channelType === "dm" &&
                                  directMessageIntro
                                  ? `Message ${directMessageIntro.displayName}`
                                  : `Message #${activeChannel.name}…`
                                : "Select a channel"
                      }
                      showLeadReference={!isActiveWelcomeChannel}
                      showTopBorder={false}
                    />
                    <ChannelComposerActivityAccessory
                      channel={activeChannel}
                      currentPubkey={currentPubkey}
                      profiles={profiles}
                      typingPubkeys={typingPubkeys}
                      visible={hasComposerBottomActivity}
                      workingIndicator={channelWorkingIndicator}
                    />
                  </div>
                </div>
              )}
              {canDropInMainColumn && mainComposerMedia.isDragOver ? (
                <DropZoneOverlay className="z-50 rounded-[var(--colony-radius-dialog)] bg-primary/20 backdrop-blur-sm" />
              ) : null}
            </div>
          </section>
        ) : null}
        {/* Serialize replacements so focus drawers keep one travel direction. */}
        <AnimatePresence mode="wait" onExitComplete={markExitComplete}>
          {channelManagementOpen && activeChannel ? (
            <ChannelManagementAuxiliaryPanel
              activeChannel={activeChannel}
              canResetThreadPanelWidth={canResetThreadPanelWidth}
              currentPubkey={currentPubkey}
              isSinglePanelView={isSinglePanelView}
              key="channel-management-panel"
              onChannelManagementDeleted={onChannelManagementDeleted}
              onCloseChannelManagement={onCloseChannelManagement}
              onOpenMembers={onOpenMembers}
              onResetThreadPanelWidth={onResetThreadPanelWidth}
              onThreadPanelResizeStart={onThreadPanelResizeStart}
              threadPanelWidthPx={threadPanelWidthPx}
              useSplitAuxiliaryPane={useSplitAuxiliaryPane}
              transparentChrome={hasSplitAuxiliaryPane}
            />
          ) : replaceThreadWithIdleAuxiliary && idleAuxiliarySurface ? (
            idleAuxiliarySurface
          ) : threadHeadMessage ? (
            (() => {
              const panel = (
                <MessageThreadPanel
                  channel={activeChannel}
                  channelId={activeChannel?.id ?? null}
                  channelName={activeChannel?.name ?? "channel"}
                  currentPubkey={currentPubkey}
                  disabled={isComposerDisabled}
                  editTarget={threadEditTarget}
                  firstUnreadReplyId={threadFirstUnreadReplyId}
                  workspaceChrome={workspaceChrome}
                  isFollowingThread={isFollowingThread}
                  isMessageUnreadById={isMessageUnreadById}
                  isSending={isSending}
                  {...threadLayoutProps}
                  autoSendDraftKey={autoSendDraftKey}
                  onAutoSubmitComplete={handleAutoSubmitComplete}
                  onCancelEdit={onCancelEdit}
                  onCancelReply={onCancelThreadReply}
                  onClose={onCloseThread}
                  onDelete={onDelete}
                  onEdit={handleRoutedEdit}
                  onEditLastOwnMessage={handleEditLastOwnThreadMessage}
                  onEditSave={onEditSave}
                  onFollowThread={onFollowThread}
                  onMarkUnread={onMarkUnread}
                  onMarkRead={onMarkRead}
                  onExpandReplies={onExpandThreadReplies}
                  onSelectReplyTarget={onSelectThreadReplyTarget}
                  onSend={onSendThreadReply}
                  onSendToChannel={
                    isComposerDisabled ? undefined : onSendToChannel
                  }
                  onScrollTargetResolved={() => resolveScrollTarget()}
                  onScrollTargetSettled={resolveScrollTarget}
                  onToggleReaction={onToggleReaction}
                  onUnfollowThread={onUnfollowThread}
                  {...{ profiles, recentMentionPubkeys: recentMentions }}
                  replyTargetMessage={threadReplyTargetMessage}
                  scrollTargetHighlights={!layoutScrollTargetId}
                  scrollTargetId={layoutScrollTargetId ?? threadScrollTargetId}
                  {...searchHighlightProps.thread}
                  threadHead={threadHeadMessage}
                  videoReviewPresentation={threadVideoReviewPresentation}
                  widthPx={threadPanelWidthPx}
                  threadReplies={threadMessages}
                  threadRepliesPending={threadMessagesPending}
                  threadRepliesError={threadMessagesError}
                  onRetryThreadReplies={onRetryThreadReplies}
                  threadUnreadCount={threadUnreadCounts?.get(
                    threadHeadMessage.id,
                  )}
                  threadReplyUnreadCounts={threadReplyUnreadCounts}
                  threadTypingPubkeys={threadTypingPubkeys}
                  activityAccessoryVisible={hasThreadComposerBotActivity}
                  activityAnnouncement={formatWorkingIndicatorLabel(
                    threadWorkingIndicator,
                  )}
                  activityAccessoryContent={
                    hasThreadComposerBotActivity ? (
                      <AgentWorkingIndicatorRow
                        profiles={profiles}
                        state={threadWorkingIndicator}
                        testId="thread-agent-working-indicator"
                      />
                    ) : null
                  }
                />
              );
              return wrapThreadPanel(panel);
            })()
          ) : shouldShowThreadSkeleton ? (
            (() => {
              const panel = (
                <MessageThreadPanelSkeleton
                  {...threadLayoutProps}
                  onClose={onCloseThread}
                  widthPx={threadPanelWidthPx}
                />
              );
              return wrapThreadPanel(panel);
            })()
          ) : profilePanelPubkey ? (
            (() => {
              const panel = (
                <UserProfilePanel
                  currentPubkey={currentPubkey}
                  isSinglePanelView={
                    useSplitAuxiliaryPane ? false : isSinglePanelView
                  }
                  layout={useSplitAuxiliaryPane ? "split" : "standalone"}
                  transparentChrome={useSplitAuxiliaryPane}
                  onClose={onCloseProfilePanel}
                  onOpenDm={onOpenDm}
                  onOpenProfile={onOpenProfilePanel}
                  onTabChange={onProfilePanelTabChange}
                  onViewChange={onProfilePanelViewChange}
                  pubkey={profilePanelPubkey}
                  splitPaneClamp
                  tab={profilePanelTab}
                  view={profilePanelView}
                  widthPx={threadPanelWidthPx}
                />
              );
              return wrapAux(panel, "user-profile-panel");
            })()
          ) : (
            idleAuxiliarySurface
          )}
        </AnimatePresence>
        <AnimatePresence onExitComplete={threadSurface.markExitComplete}>
          {showIdleAuxiliaryOverThread ? idleAuxiliarySurface : null}
        </AnimatePresence>
      </div>
    </WorkItemReferenceContext.Provider>
  );
});
