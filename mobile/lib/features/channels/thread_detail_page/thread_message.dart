part of '../thread_detail_page.dart';

class _ThreadMessage extends HookConsumerWidget {
  final TimelineMessage message;
  final Map<String, String> channelNames;
  final String channelId;
  final String? currentPubkey;
  final bool showAuthor;
  final bool followsDayDivider;
  final double authorSpacing;
  final bool isHighlighted;
  final List<TimelineMessage>? allMessages;
  final bool isMember;
  final bool isArchived;
  final FocusNode? composerFocusNode;
  final VoidCallback? restoreComposerFocus;

  /// Whether this is the message the thread hangs off, which keeps a standing
  /// "+" where replies only get one once they carry a reaction.
  final bool isThreadHead;

  const _ThreadMessage({
    required this.message,
    required this.channelNames,
    required this.channelId,
    required this.currentPubkey,
    required this.showAuthor,
    this.followsDayDivider = false,
    this.authorSpacing = Grid.eighteen,
    this.isHighlighted = false,
    this.allMessages,
    this.isMember = false,
    this.isArchived = false,
    this.isThreadHead = false,
    this.composerFocusNode,
    this.restoreComposerFocus,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final messageSnapshotKey = useMemoized(GlobalKey.new, const []);
    final presentation = ref.watch(
      channelMessagePresentationProvider.select((items) => items[message.id]),
    );
    final workItemReference = workItemReferenceFromTags(
      message.tags,
      clientId: channelId,
    );
    final pk = message.pubkey.toLowerCase();
    ref.read(presenceCacheProvider.notifier).track([pk]);
    final isOnline = ref.watch(
      presenceCacheProvider.select((presence) => presence[pk] == 'online'),
    );
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);
    final displayName = profile?.label ?? shortPubkey(message.pubkey);
    final isAgent =
        ref.watch(agentMentionPubkeysProvider(channelId)).contains(pk) ||
        profile?.ownerPubkey != null;
    final canManageMessage =
        currentPubkey?.toLowerCase() == pk ||
        (profile?.ownerPubkey != null &&
            profile?.ownerPubkey == currentPubkey?.toLowerCase());

    final userCache = ref.watch(userCacheProvider);
    final knownAgentPubkeys = agentPubkeysWithProfileOwners(
      knownAgentPubkeys: ref.watch(agentMentionPubkeysProvider(channelId)),
      profileOwnedAgentPubkeys: [
        for (final profile in userCache.values)
          if (profile.ownerPubkey != null) profile.pubkey,
      ],
    );
    final mentionNames = <String, String>{};
    final agentMentionPubkeys = <String>{};
    for (final mpk in message.mentionPubkeys) {
      final normalizedPubkey = mpk.toLowerCase();
      final p = userCache[normalizedPubkey];
      if (p?.displayName != null) {
        mentionNames[normalizedPubkey] = p!.displayName!;
      }
      if (knownAgentPubkeys.contains(normalizedPubkey)) {
        agentMentionPubkeys.add(normalizedPubkey);
      }
    }
    final resolvedMentionNames = mentionNamesWithDirectoryLabels(
      mentionPubkeys: message.mentionPubkeys,
      profileMentionNames: mentionNames,
      directoryDisplayNames: ref.watch(agentDirectoryDisplayNamesProvider),
      agentMentionPubkeys: agentMentionPubkeys,
    );

    void openMessageActions(MessageLongPressDetails details) {
      showMessageActions(
        context: context,
        ref: ref,
        message: message,
        channelId: channelId,
        canManageMessage: canManageMessage,
        allMessages: allMessages,
        currentPubkey: currentPubkey,
        isMember: isMember,
        isArchived: isArchived,
        anchorRect: details.anchorRect,
        captureAnchorSnapshot: details.captureSnapshot,
        onPopoverPreviewVisibilityChanged: details.setSourceHidden,
        onPopoverDismissed: () => details.setSourceHidden(false),
        composerFocusNode: composerFocusNode,
        restoreComposerFocus: restoreComposerFocus,
      );
    }

    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final highlightController = useAnimationController(
      duration: _landingHighlightTransitionDuration,
    );
    final highlightProgress = useAnimation(highlightController);
    useEffect(() {
      if (reducedMotion) {
        highlightController.value = isHighlighted ? 1 : 0;
      } else {
        unawaited(
          highlightController.animateTo(
            isHighlighted ? 1 : 0,
            duration: _landingHighlightTransitionDuration,
            curve: Curves.easeOutCubic,
          ),
        );
      }
      return null;
    }, [highlightController, isHighlighted, reducedMotion]);
    final highlightColor = highlightProgress == 0
        ? Colors.transparent
        : context.colors.primary.withValues(
            alpha: _landingHighlightOpacity * highlightProgress,
          );

    return Padding(
      padding: conversationMessageVerticalPadding(
        showAuthor: showAuthor,
        followsDayDivider: followsDayDivider,
        authorSpacing: authorSpacing,
      ),
      child: DecoratedBox(
        key: ValueKey('thread-message-${message.id}'),
        decoration: BoxDecoration(
          color: highlightColor,
          borderRadius: BorderRadius.circular(Radii.md),
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(Radii.md),
          // The media carousel intentionally continues through the list's
          // trailing gutter. InkWell still clips its ink to [borderRadius],
          // while leaving overflowing message content visible.
          clipBehavior: Clip.none,
          child: MessageLongPressInkWell(
            key: ValueKey('thread-message-row-${message.id}'),
            onLongPressDetails: openMessageActions,
            borderRadius: BorderRadius.circular(Radii.md),
            highlightColor: context.colors.primary.withValues(alpha: 0.1),
            snapshotKey: messageSnapshotKey,
            child: Padding(
              padding: EdgeInsets.only(
                top: showAuthor ? 0 : Grid.xxs,
                bottom: showAuthor ? 0 : Grid.xxs,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  RepaintBoundary(
                    key: messageSnapshotKey,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (showAuthor)
                          GestureDetector(
                            onTap: () =>
                                showUserProfileSheet(context, message.pubkey),
                            child: _Avatar(
                              profile: profile,
                              pubkey: message.pubkey,
                              isAgent: isAgent,
                              isOnline: isOnline,
                            ),
                          )
                        else
                          const SizedBox(width: conversationAvatarSize),
                        const SizedBox(width: conversationAvatarGap),
                        Expanded(
                          child: Padding(
                            padding: EdgeInsets.zero,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (showAuthor)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 9),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: MessageAuthorMeta(
                                            displayName: displayName,
                                            username: isAgent
                                                ? null
                                                : messageUsernameLabel(profile),
                                            timestamp: formatMessageTime(
                                              message.createdAt,
                                            ),
                                            nameColor: conversationInkColor(
                                              context,
                                            ),
                                            metadataColor:
                                                conversationMutedColor(context),
                                            onAuthorTap: () =>
                                                showUserProfileSheet(
                                                  context,
                                                  message.pubkey,
                                                ),
                                            badge: isAgent
                                                ? const ConversationAgentBadge()
                                                : null,
                                            nameStyle:
                                                conversationAuthorTextStyle,
                                            timestampStyle:
                                                conversationTimestampTextStyle,
                                            displayNameKey: ValueKey(
                                              'thread-message-author-${message.id}',
                                            ),
                                            usernameKey: ValueKey(
                                              'thread-message-username-${message.id}',
                                            ),
                                            timestampKey: ValueKey(
                                              'thread-message-timestamp-${message.id}',
                                            ),
                                          ),
                                        ),
                                        if (message.edited) ...[
                                          const SizedBox(width: Grid.half),
                                          Text(
                                            '(edited)',
                                            style: context.textTheme.labelSmall
                                                ?.copyWith(
                                                  color: conversationMutedColor(
                                                    context,
                                                  ),
                                                  fontStyle: FontStyle.italic,
                                                ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                MessageContent(
                                  content: message.content,
                                  mentionNames: resolvedMentionNames,
                                  agentMentionPubkeys: agentMentionPubkeys,
                                  channelNames: channelNames,
                                  tags: message.tags,
                                  baseStyle: conversationBodyTextStyle.copyWith(
                                    color: conversationInkColor(context),
                                  ),
                                  scaleEmojiOnly: true,
                                  mediaCarouselTrailingOverflow: Grid.gutter,
                                  onMediaReply: allMessages == null
                                      ? null
                                      : () {
                                          if (!context.mounted) return;
                                          Navigator.of(context).push(
                                            MaterialPageRoute<void>(
                                              builder: (_) => ThreadDetailPage(
                                                threadHead: message,
                                                allMessages: allMessages!,
                                                channelId: channelId,
                                                currentPubkey: currentPubkey,
                                                isMember: isMember,
                                                isArchived: isArchived,
                                              ),
                                            ),
                                          );
                                        },
                                  onMediaMore: (viewerContext, imageUrl) =>
                                      showImageActions(
                                        context: viewerContext,
                                        ref: ref,
                                        message: message,
                                        channelId: channelId,
                                        imageUrl: imageUrl,
                                        canManageMessage: canManageMessage,
                                        onDeleted: () {
                                          if (viewerContext.mounted) {
                                            Navigator.of(
                                              viewerContext,
                                            ).maybePop();
                                          }
                                        },
                                      ),
                                  onChannelTap: (targetChannelId) {
                                    openChannelLink(
                                      context: context,
                                      ref: ref,
                                      channelId: targetChannelId,
                                      currentChannelId: channelId,
                                    );
                                  },
                                  onMentionTap: (pubkey) =>
                                      showUserProfileSheet(context, pubkey),
                                ),
                                if (workItemReference != null)
                                  DeliverableReferenceCard(
                                    reference: workItemReference,
                                    clientName:
                                        channelNames[channelId] ?? channelId,
                                  )
                                else if (presentation?.deliverable
                                    case final deliverable?)
                                  DeliverablePreviewCard(data: deliverable),
                                if (presentation?.quote case final quote?)
                                  QuotedMessagePreview(
                                    label: quote.label,
                                    content: quote.content,
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (isThreadHead || message.reactions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(
                        left: conversationReplyIndent,
                      ),
                      child: ReactionRow(
                        messageId: message.id,
                        reactions: message.reactions,
                        onToggle: (emoji) =>
                            toggleReaction(ref, message, emoji),
                        compact: true,
                        showAddButton: !isThreadHead && isMember && !isArchived,
                        onAddReaction: () => showAddReactionPicker(
                          context: context,
                          ref: ref,
                          message: message,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
