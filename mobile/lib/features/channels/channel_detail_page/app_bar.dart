part of '../channel_detail_page.dart';

bool _showsMembersAction(Channel channel) {
  if (!channel.isDm) return true;
  final participants = channel.participantPubkeys
      .map((pubkey) => pubkey.toLowerCase())
      .toSet();
  return participants.length != 2;
}

double _scaledTextHeight(BuildContext context, TextStyle style) {
  final scaledFontSize = MediaQuery.textScalerOf(
    context,
  ).scale(style.fontSize ?? 0);
  return scaledFontSize * (style.height ?? 1);
}

double _twoLineAppBarTitleContentHeight(BuildContext context) {
  final typography = context.mobileTypography;
  final titleStyle = typography.body.copyWith(fontSize: 14, height: 1.25);
  final subtitleStyle = typography.metadata.copyWith(fontSize: 10, height: 1.3);
  return _scaledTextHeight(context, titleStyle) +
      _scaledTextHeight(context, subtitleStyle);
}

class _ChannelAppBarTitle extends ConsumerWidget {
  const _ChannelAppBarTitle({required this.channel, required this.onTap});

  final Channel channel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final membersAsync = ref.watch(channelMembersProvider(channel.id));
    final members = membersAsync.asData?.value;
    final memberCount = members?.length ?? channel.memberCount;
    final agentCount = members?.where((member) => member.isBot).length;
    final memberLabel =
        '${channel.isForum ? 'Forum · ' : ''}'
        '$memberCount ${memberCount == 1 ? 'member' : 'members'}'
        '${agentCount == null || agentCount == 0 ? '' : ' · $agentCount agents'}';
    final tokens = context.mobileTokens;
    final typography = context.mobileTypography;

    return Semantics(
      button: true,
      label: 'Open settings for ${channel.name}, $memberLabel',
      child: Tooltip(
        message: 'Open channel settings',
        child: InkWell(
          key: const ValueKey('channel-header-settings-trigger'),
          borderRadius: BorderRadius.circular(Radii.md),
          onTap: onTap,
          child: Row(
            children: [
              Expanded(
                child: ConstrainedBox(
                  key: const ValueKey('channel-header-text-stack'),
                  constraints: const BoxConstraints(minHeight: 40),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              channel.name,
                              key: const ValueKey('channel-header-name'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: typography.body.copyWith(
                                color: tokens.ink,
                                fontSize: channel.isForum ? 16 : 14,
                                fontWeight: FontWeight.w700,
                                height: 1.25,
                              ),
                            ),
                          ),
                          if (channel.isEphemeral) ...[
                            const SizedBox(width: Grid.quarter),
                            _HeaderEphemeralBadge(channel: channel),
                          ],
                          if (channel.visibility == 'private') ...[
                            const SizedBox(width: Grid.quarter),
                            ExcludeSemantics(
                              child: Icon(
                                LucideIcons.lock,
                                key: const ValueKey('channel-header-private'),
                                size: 12,
                                color: tokens.muted,
                              ),
                            ),
                          ],
                        ],
                      ),
                      Text(
                        memberLabel,
                        key: const ValueKey('channel-header-member-count'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: typography.metadata.copyWith(
                          color: tokens.muted,
                          fontSize: channel.isForum ? 11 : 10,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MembersButton extends ConsumerWidget {
  final String channelId;
  final Channel channel;
  final String? currentPubkey;

  const _MembersButton({
    required this.channelId,
    required this.channel,
    required this.currentPubkey,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasWorkingBot = ref
        .watch(workingBotPubkeysProvider(channelId))
        .isNotEmpty;

    return IconButton(
      color: context.colors.primary,
      onPressed: () {
        showBuzzModalBottomSheet<void>(
          context: context,
          title: 'Members',
          isScrollControlled: true,
          showDragHandle: true,
          builder: (_) =>
              MembersSheet(channel: channel, currentPubkey: currentPubkey),
        );
      },
      tooltip: 'View members',
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          const Icon(LucideIcons.users, size: 22),
          if (hasWorkingBot)
            Positioned(
              top: -2,
              right: -2,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: context.appColors.success,
                  shape: BoxShape.circle,
                  border: Border.all(color: context.colors.surface, width: 1.5),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DmAppBarTitle extends ConsumerWidget {
  final Channel channel;
  final String? currentPubkey;

  const _DmAppBarTitle({required this.channel, required this.currentPubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final normalizedCurrent = currentPubkey?.toLowerCase();

    String? otherPubkey;
    for (final pk in channel.participantPubkeys) {
      if (pk.toLowerCase() != normalizedCurrent) {
        otherPubkey = pk.toLowerCase();
        break;
      }
    }

    final profile = ref.watch(
      userCacheProvider.select(
        (profiles) => otherPubkey == null ? null : profiles[otherPubkey],
      ),
    );
    final presence = ref.watch(
      presenceCacheProvider.select(
        (presenceMap) => otherPubkey == null
            ? 'offline'
            : (presenceMap[otherPubkey] ?? 'offline'),
      ),
    );

    if (otherPubkey != null) {
      if (profile == null) {
        ref.read(userCacheProvider.notifier).preload([otherPubkey]);
      }
      ref.read(presenceCacheProvider.notifier).track([otherPubkey]);
    }

    final isAgent =
        (otherPubkey != null &&
            ref
                .watch(agentMentionPubkeysProvider(channel.id))
                .contains(otherPubkey)) ||
        profile?.ownerPubkey != null;
    final presenceLabel = switch (presence) {
      'online' => isAgent ? 'Agent · Ready' : 'Available',
      'away' => isAgent ? 'Agent · Away' : 'Away',
      _ => isAgent ? 'Agent · Offline' : 'Offline',
    };
    final tokens = context.mobileTokens;
    final typography = context.mobileTypography;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                resolveDmChannelDisplayLabel(
                  channel,
                  currentPubkey: currentPubkey,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                key: const ValueKey('dm-header-name'),
                style: typography.body.copyWith(
                  color: tokens.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                ),
              ),
            ),
            if (channel.isEphemeral) ...[
              const SizedBox(width: Grid.quarter),
              _HeaderEphemeralBadge(channel: channel),
            ],
          ],
        ),
        Text(
          presenceLabel,
          key: const ValueKey('dm-header-presence'),
          style: typography.metadata.copyWith(
            color: tokens.muted,
            fontSize: 10,
          ),
        ),
      ],
    );
  }
}
