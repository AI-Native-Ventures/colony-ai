part of '../channels_page.dart';

class _ChannelTile extends ConsumerWidget {
  final Channel channel;
  final bool isUnread;
  final bool isMuted;
  final String? currentPubkey;
  final VoidCallback onTap;

  /// Called when the user requests to mark this channel read (from long-press
  /// actions menu). Null for channels in built-in sections.
  final VoidCallback? onMarkRead;

  /// The user-defined section this channel currently belongs to, or null.
  final String? sectionId;

  const _ChannelTile({
    required this.channel,
    required this.isUnread,
    required this.currentPubkey,
    required this.onTap,
    this.isMuted = false,
    this.onMarkRead,
    this.sectionId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authorPubkey = channel.lastMessagePubkey?.toLowerCase();
    final profile = authorPubkey == null
        ? null
        : ref.watch(
            userCacheProvider.select((profiles) => profiles[authorPubkey]),
          );
    if (authorPubkey != null && profile == null) {
      ref.read(userCacheProvider.notifier).preload([authorPubkey]);
    }
    final readState = ref.watch(readStateProvider);
    final unreadCount = isUnread
        ? (_computeUnreadChannelState(
                    channels: [channel],
                    readState: readState,
                    channelsNotifier: ref.read(channelsProvider.notifier),
                  ).counts[channel.id] ??
                  1)
              .clamp(1, 99)
              .toInt()
        : 0;
    final preview = channel.lastMessageContent ?? '';
    final authorName = profile?.displayName?.trim();
    final prefix = channel.isDm || authorPubkey == null
        ? ''
        : currentPubkey?.toLowerCase() == authorPubkey
        ? 'You: '
        : authorName != null && authorName.isNotEmpty
        ? '$authorName: '
        : '';
    final mutedColor = context.mobileTokens.muted;
    final time = _channelListTime(channel);

    return InkWell(
      key: ValueKey('conversation-row-${channel.id}'),
      onTap: onTap,
      onLongPress: () => _showChannelActions(context, ref),
      child: Container(
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: MobileLayoutTokens.contentGutter,
          vertical: Grid.xs,
        ),
        child: Row(
          children: [
            _ConversationAvatar(channel: channel, currentPubkey: currentPubkey),
            const SizedBox(width: Grid.xs),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          resolveDmChannelDisplayLabel(
                            channel,
                            currentPubkey: currentPubkey,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.identityName.copyWith(
                            color: isMuted
                                ? mutedColor
                                : context.mobileTokens.ink,
                          ),
                        ),
                      ),
                      if (channel.isEphemeral) ...[
                        const SizedBox(width: Grid.half),
                        _EphemeralBadge(channel: channel),
                      ],
                      if (isMuted) ...[
                        const SizedBox(width: Grid.half),
                        Tooltip(
                          message: 'Muted',
                          child: Icon(
                            LucideIcons.bellOff,
                            size: Grid.xs,
                            color: mutedColor,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (preview.isNotEmpty) ...[
                    const SizedBox(height: Grid.quarter),
                    Text(
                      '$prefix$preview',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.metadata.copyWith(
                        color: mutedColor,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: Grid.half),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (time.isNotEmpty)
                  Text(
                    time,
                    style: context.mobileTypography.identityStatus.copyWith(
                      color: mutedColor,
                    ),
                  ),
                if (unreadCount > 0) ...[
                  const SizedBox(height: Grid.half),
                  Container(
                    key: ValueKey('channel-unread-badge-${channel.id}'),
                    constraints: const BoxConstraints(minWidth: Grid.lg),
                    padding: const EdgeInsets.symmetric(
                      horizontal: Grid.half,
                      vertical: Grid.quarter,
                    ),
                    decoration: BoxDecoration(
                      color: context.appColors.plum,
                      borderRadius: BorderRadius.circular(Radii.tapTarget),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      unreadCount == 99 ? '99+' : '$unreadCount',
                      style: context.mobileTypography.identityStatus.copyWith(
                        color: context.mobileTokens.onAction,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _showChannelActions(BuildContext context, WidgetRef ref) {
    showChannelActionsSheet(
      context: context,
      channel: channel,
      isUnread: isUnread,
      onMarkRead: onMarkRead,
      sectionId: sectionId,
    );
  }
}

String _channelListTime(Channel channel) {
  final timestamp =
      channel.lastMessageCreatedAt ??
      dateTimeToUnixSeconds(channel.lastMessageAt);
  if (timestamp == null) return '';
  final date = DateTime.fromMillisecondsSinceEpoch(
    timestamp * 1000,
    isUtc: true,
  ).toLocal();
  final now = DateTime.now();
  final elapsed = now.difference(date);
  if (elapsed.isNegative || elapsed.inSeconds < 60) return 'now';
  if (elapsed.inMinutes < 60) return '${elapsed.inMinutes}m';
  if (elapsed.inHours < 24) return '${elapsed.inHours}h';
  final yesterday = now.subtract(const Duration(days: 1));
  if (date.year == yesterday.year &&
      date.month == yesterday.month &&
      date.day == yesterday.day) {
    return 'Yesterday';
  }
  return '${date.month}/${date.day}';
}

class _ConversationAvatar extends ConsumerWidget {
  const _ConversationAvatar({
    required this.channel,
    required this.currentPubkey,
  });

  final Channel channel;
  final String? currentPubkey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final size = MobileLayoutTokens.companyHeaderAvatarSize;
    if (!channel.isDm) {
      final appColors = context.appColors;
      final channelTone = channel.name.toLowerCase().runes.fold<int>(
        0,
        (sum, rune) => sum + rune,
      );
      final backgroundGradient = switch (channelTone % 3) {
        0 => appColors.personAvatarGradient,
        1 => appColors.sageAvatarGradient,
        _ => appColors.agentAvatarGradient,
      };
      return DecoratedBox(
        key: ValueKey('conversation-avatar-${channel.id}'),
        decoration: BoxDecoration(
          gradient: backgroundGradient,
          borderRadius: BorderRadius.circular(Radii.button),
        ),
        child: SizedBox.square(
          dimension: size,
          child: Center(
            child: channel.isForum
                ? Icon(
                    LucideIcons.fileText,
                    size: Grid.sm,
                    color: appColors.plum,
                  )
                : Text(
                    '#',
                    style: context.mobileTypography.conversation.copyWith(
                      color: context.appColors.plum,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
          ),
        ),
      );
    }

    final normalizedCurrent = currentPubkey?.toLowerCase();
    final otherPubkeys = [
      for (final pubkey in channel.participantPubkeys)
        if (pubkey.toLowerCase() != normalizedCurrent) pubkey.toLowerCase(),
    ];
    final visiblePubkeys = otherPubkeys.isNotEmpty
        ? otherPubkeys
        : channel.participantPubkeys
              .map((pubkey) => pubkey.toLowerCase())
              .toList();
    if (visiblePubkeys.length > 1) {
      return DecoratedBox(
        key: ValueKey('conversation-avatar-${channel.id}'),
        decoration: BoxDecoration(
          color: context.mobileTokens.actionSoft,
          borderRadius: BorderRadius.circular(Radii.button),
        ),
        child: SizedBox.square(
          dimension: size,
          child: Center(
            child: Text(
              '${visiblePubkeys.length}',
              style: context.mobileTypography.identityName.copyWith(
                color: context.mobileTokens.onActionSoft,
              ),
            ),
          ),
        ),
      );
    }

    final otherPubkey = visiblePubkeys.firstOrNull;
    final profile = ref.watch(
      userCacheProvider.select(
        (profiles) => otherPubkey == null ? null : profiles[otherPubkey],
      ),
    );
    if (otherPubkey != null && profile == null) {
      ref.read(userCacheProvider.notifier).preload([otherPubkey]);
    }
    final fallbackInitial =
        profile?.initials ??
        dmAvatarInitial(channel, currentPubkey: currentPubkey);
    final isAgent = profile?.isAgent == true || profile?.ownerPubkey != null;
    return IdentityAvatar(
      key: ValueKey('conversation-avatar-${channel.id}'),
      initials: fallbackInitial,
      kind: isAgent ? IdentityKind.agent : IdentityKind.person,
      imageUrl: profile?.avatarUrl,
      size: size,
      semanticLabel: resolveDmChannelDisplayLabel(
        channel,
        currentPubkey: currentPubkey,
      ),
      excludeSemantics: true,
    );
  }
}
