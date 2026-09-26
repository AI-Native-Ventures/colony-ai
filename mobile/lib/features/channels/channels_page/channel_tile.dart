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
    final mutedColor = _chatMuted(context);
    final time = _channelListTime(channel);

    return InkWell(
      key: ValueKey('conversation-row-${channel.id}'),
      borderRadius: BorderRadius.circular(Radii.md),
      onTap: onTap,
      onLongPress: () => _showChannelActions(context, ref),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        child: Row(
          children: [
            _ConversationAvatar(channel: channel, currentPubkey: currentPubkey),
            const SizedBox(width: 12),
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
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: isMuted ? mutedColor : _chatInk(context),
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            height: 1.25,
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
                            size: 12,
                            color: mutedColor,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (preview.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(
                      '$prefix$preview',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(
                        color: mutedColor,
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (time.isNotEmpty)
                  Text(
                    time,
                    style: context.textTheme.labelSmall?.copyWith(
                      color: mutedColor,
                      fontSize: 10,
                    ),
                  ),
                if (unreadCount > 0) ...[
                  const SizedBox(height: 7),
                  Container(
                    constraints: const BoxConstraints(minWidth: 24),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: _chatBlue(context),
                      borderRadius: BorderRadius.circular(7),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      unreadCount == 99 ? '99+' : '$unreadCount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        height: 1.1,
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
  if (date.year == now.year && date.month == now.month && date.day == now.day) {
    return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
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
    if (!channel.isDm) {
      return Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border.all(color: _chatLine(context)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '#',
          style: TextStyle(color: _chatMuted(context), fontSize: 21, height: 1),
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
      return Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: _chatSoft(context),
          borderRadius: BorderRadius.circular(11),
        ),
        child: Text(
          '${visiblePubkeys.length}',
          style: context.textTheme.labelSmall?.copyWith(
            color: _chatInk(context),
            fontWeight: FontWeight.w700,
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
    final fallbackInitial = profile?.displayName?.trim().isNotEmpty == true
        ? _chatInitials(profile!.displayName)
        : dmAvatarInitial(channel, currentPubkey: currentPubkey);
    return ClipRRect(
      borderRadius: BorderRadius.circular(11),
      child: ColoredBox(
        color: _chatSoft(context),
        child: SizedBox(
          width: 38,
          height: 38,
          child: AvatarImageContent(
            imageUrl: profile?.avatarUrl,
            fallback: Text(
              fallbackInitial,
              style: context.textTheme.labelMedium?.copyWith(
                color: _chatInk(context),
                fontWeight: FontWeight.w700,
                fontSize: 11,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
