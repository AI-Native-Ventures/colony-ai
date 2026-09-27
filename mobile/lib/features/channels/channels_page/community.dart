part of '../channels_page.dart';

class _CommunitySwitcherSheet extends HookConsumerWidget {
  const _CommunitySwitcherSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final communitiesAsync = ref.watch(communityListProvider);
    final activeAsync = ref.watch(activeCommunityProvider);
    final isEditing = useState(false);

    return SafeArea(
      child: BuzzTitledSheetLayout(
        key: const Key('community-switcher-sheet'),
        title: 'Switch Community',
        titleKey: const Key('community-switcher-title'),
        showDragHandle: true,
        trailing: SizedBox(
          key: const Key('community-switcher-edit'),
          width: 56,
          height: 44,
          child: TextButton(
            onPressed: () => isEditing.value = !isEditing.value,
            style: TextButton.styleFrom(
              minimumSize: const Size(56, 44),
              padding: EdgeInsets.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(isEditing.value ? 'Done' : 'Edit'),
          ),
        ),
        child: communitiesAsync.when(
          loading: () => const SizedBox(
            height: 120,
            child: Center(
              child: BuzzLoadingIndicator(
                size: 40,
                semanticLabel: 'Loading communities',
              ),
            ),
          ),
          error: (e, _) => Padding(
            padding: const EdgeInsets.all(Grid.xs),
            child: Text('Error loading communities: $e'),
          ),
          data: (communities) {
            final activeId = activeAsync.value?.id;
            return SingleChildScrollView(
              padding: const EdgeInsets.only(bottom: Grid.xs),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
                child: Material(
                  key: const Key('community-switcher-options'),
                  color: context.colors.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(Radii.card),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      for (
                        var index = 0;
                        index < communities.length;
                        index++
                      ) ...[
                        if (index > 0) const _CommunitySwitcherDivider(),
                        _CommunitySwitcherTile(
                          community: communities[index],
                          isActive: communities[index].id == activeId,
                          isEditing: isEditing.value,
                          onTap: isEditing.value
                              ? null
                              : () async {
                                  final community = communities[index];
                                  if (community.id != activeId) {
                                    await ref
                                        .read(communityListProvider.notifier)
                                        .switchCommunity(community.id);
                                  }
                                  if (context.mounted) {
                                    Navigator.of(context).pop();
                                  }
                                },
                          onRemove: () => _confirmRemoveCommunity(
                            context,
                            ref,
                            communities[index],
                            closeSheetAfterRemoval:
                                communities[index].id == activeId,
                          ),
                        ),
                      ],
                      if (communities.isNotEmpty)
                        const _CommunitySwitcherDivider(),
                      _AddCommunityTile(
                        onTap: () {
                          final nav = Navigator.of(
                            context,
                            rootNavigator: true,
                          );
                          ref.read(pairingProvider.notifier).reset();
                          Navigator.of(context).pop();
                          nav.push(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  const PairingPage(addingCommunity: true),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

const double _communitySwitcherAvatarSize = 36;

class _CommunitySwitcherDivider extends StatelessWidget {
  const _CommunitySwitcherDivider();

  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: Grid.xs + _communitySwitcherAvatarSize + Grid.xs,
      endIndent: 0,
      color: context.colors.onSurface.withValues(alpha: 0.12),
    );
  }
}

class _CommunitySwitcherTile extends StatelessWidget {
  final Community community;
  final bool isActive;
  final bool isEditing;
  final VoidCallback? onTap;
  final VoidCallback onRemove;

  const _CommunitySwitcherTile({
    required this.community,
    required this.isActive,
    required this.isEditing,
    required this.onTap,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final host = Uri.tryParse(community.relayUrl)?.host ?? community.relayUrl;

    return InkWell(
      key: Key('community-switcher-row-${community.id}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Grid.xs,
          Grid.twelve,
          Grid.xxs,
          Grid.twelve,
        ),
        child: Row(
          children: [
            _CommunityAvatar(
              key: Key('community-switcher-avatar-${community.id}'),
              name: community.name,
              relayUrl: community.relayUrl,
              size: _communitySwitcherAvatarSize,
            ),
            const SizedBox(width: Grid.xs),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    community.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.bodyLarge?.copyWith(
                      fontWeight: isActive
                          ? FontWeight.w600
                          : FontWeight.normal,
                    ),
                  ),
                  const SizedBox(height: Grid.quarter),
                  Text(
                    host,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: Grid.xxs),
            _CommunityActionSwap(
              key: Key('community-switcher-action-${community.id}'),
              communityId: community.id,
              communityName: community.name,
              isActive: isActive,
              isEditing: isEditing,
              onRemove: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

const _communityActionSwapDuration = Duration(milliseconds: 250);
const double _communityActionSwapBlur = 2;
const double _communityActionSwapStartScale = 0.25;

class _CommunityActionSwap extends StatelessWidget {
  const _CommunityActionSwap({
    super.key,
    required this.communityId,
    required this.communityName,
    required this.isActive,
    required this.isEditing,
    required this.onRemove,
  });

  final String communityId;
  final String communityName;
  final bool isActive;
  final bool isEditing;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    return SizedBox.square(
      dimension: 40,
      child: AnimatedSwitcher(
        duration: reduceMotion ? Duration.zero : _communityActionSwapDuration,
        reverseDuration: reduceMotion
            ? Duration.zero
            : _communityActionSwapDuration,
        transitionBuilder: (child, animation) {
          final eased = CurvedAnimation(
            parent: animation,
            curve: Curves.easeInOut,
          );
          return AnimatedBuilder(
            animation: eased,
            child: child,
            builder: (context, child) {
              final progress = eased.value;
              final blur = _communityActionSwapBlur * (1 - progress);
              final scale =
                  _communityActionSwapStartScale +
                  ((1 - _communityActionSwapStartScale) * progress);
              return Opacity(
                opacity: progress,
                child: ImageFiltered(
                  enabled: blur > 0.01,
                  imageFilter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
                  child: Transform.scale(scale: scale, child: child),
                ),
              );
            },
          );
        },
        child: isEditing
            ? IconButton(
                key: ValueKey('community-switcher-remove-$communityId'),
                tooltip: 'Remove $communityName',
                visualDensity: VisualDensity.compact,
                onPressed: onRemove,
                icon: Icon(
                  LucideIcons.trash2,
                  size: 18,
                  color: context.colors.error,
                ),
              )
            : Center(
                key: ValueKey('community-switcher-selection-$communityId'),
                child: _CommunitySelectionIndicator(
                  key: ValueKey('community-switcher-circle-$communityId'),
                  communityName: communityName,
                  isActive: isActive,
                ),
              ),
      ),
    );
  }
}

class _CommunitySelectionIndicator extends StatelessWidget {
  const _CommunitySelectionIndicator({
    super.key,
    required this.communityName,
    required this.isActive,
  });

  final String communityName;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: isActive
          ? '$communityName is the current community'
          : 'Switch to $communityName',
      child: Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          color: isActive ? context.appColors.success : Colors.transparent,
          border: isActive
              ? null
              : Border.all(color: context.colors.outlineVariant, width: 2),
          shape: BoxShape.circle,
        ),
        child: isActive
            ? const Icon(LucideIcons.check, color: Colors.white, size: 16)
            : null,
      ),
    );
  }
}

class _AddCommunityTile extends StatelessWidget {
  const _AddCommunityTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: const Key('community-switcher-add'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.xs,
          vertical: Grid.twelve,
        ),
        child: Row(
          children: [
            Container(
              width: _communitySwitcherAvatarSize,
              height: _communitySwitcherAvatarSize,
              decoration: BoxDecoration(
                color: context.colors.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(
                LucideIcons.plus,
                size: 18,
                color: context.colors.onPrimaryContainer,
              ),
            ),
            const SizedBox(width: Grid.xs),
            Text(
              'Add Community',
              style: context.textTheme.bodyLarge?.copyWith(
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _confirmRemoveCommunity(
  BuildContext context,
  WidgetRef ref,
  Community community, {
  required bool closeSheetAfterRemoval,
}) async {
  final confirmed = await showBuzzDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog.adaptive(
      title: const Text('Remove community?'),
      content: Text(
        'Are you sure you want to remove “${community.name}”? '
        'You can pair with it again later.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          style: FilledButton.styleFrom(backgroundColor: context.colors.error),
          child: const Text('Remove'),
        ),
      ],
    ),
  );

  if (confirmed != true || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref
        .read(communityListProvider.notifier)
        .removeCommunity(community.id);
    if (closeSheetAfterRemoval && context.mounted) {
      Navigator.of(context).pop();
    }
  } catch (e) {
    messenger.showSnackBar(
      SnackBar(content: Text('Failed to remove community: $e')),
    );
  }
}

class _CommunityIndicator extends ConsumerWidget {
  const _CommunityIndicator();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeAsync = ref.watch(activeCommunityProvider);

    final activeCommunity = activeAsync.value;

    final iconUrl = activeCommunity?.relayUrl == null
        ? null
        : ref.watch(communityIconProvider(activeCommunity!.relayUrl)).value;
    final name = activeCommunity?.name.trim();
    return ClipRRect(
      key: const ValueKey('community-indicator'),
      borderRadius: BorderRadius.circular(10),
      child: ColoredBox(
        color: const Color(0xFFE4ECDF),
        child: SizedBox(
          width: 36,
          height: 36,
          child: iconUrl == null
              ? Center(
                  child: Text(
                    _chatInitials(name).toLowerCase(),
                    style: const TextStyle(
                      color: Color(0xFF6E8864),
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                )
              : Image.network(
                  iconUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Center(
                    child: Text(
                      _chatInitials(name).toLowerCase(),
                      style: const TextStyle(
                        color: Color(0xFF6E8864),
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

class _CommunityHeaderTitle extends ConsumerWidget {
  final TextStyle? style;

  const _CommunityHeaderTitle({this.style});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = ref.watch(activeCommunityProvider).value?.name.trim();
    final title = name == null || name.isEmpty ? 'Business' : name;
    return SizedBox.expand(
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: Grid.xxs),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: style,
              ),
              Text(
                'Your business, together',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.bodySmall?.copyWith(
                  color: const Color(0xFF8B8590),
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BusinessSwitchButton extends ConsumerWidget {
  const _BusinessSwitchButton({
    super.key,
    required this.onTap,
    required this.onLongPress,
  });

  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).value;
    final initials = profile == null
        ? '?'
        : _chatInitials(profile.displayName, fallback: profile.initial);
    return Semantics(
      button: true,
      label: 'Switch business',
      onTap: onTap,
      customSemanticsActions: {
        CustomSemanticsAction(label: 'Open Settings'): onLongPress,
      },
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        onLongPress: onLongPress,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: ColoredBox(
            color: const Color(0xFFE8E2EC),
            child: SizedBox(
              width: 36,
              height: 36,
              child: profile?.avatarUrl == null
                  ? Center(
                      child: Text(
                        initials,
                        style: const TextStyle(
                          color: Color(0xFF76657D),
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    )
                  : Image.network(
                      profile!.avatarUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => Center(
                        child: Text(
                          initials,
                          style: const TextStyle(
                            color: Color(0xFF76657D),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CommunityAvatar extends ConsumerWidget {
  final String? name;
  final String? relayUrl;
  final double size;

  const _CommunityAvatar({
    super.key,
    required this.name,
    this.relayUrl,
    this.size = _kTopSectionCommunityAvatarSize,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initials = _chatInitials(name);
    final relay = relayUrl;
    final iconUrl = relay == null
        ? null
        : ref.watch(communityIconProvider(relay)).value;

    return AvatarImage(
      imageUrl: iconUrl,
      radius: size / 2,
      backgroundColor: context.colors.primaryContainer,
      fallback: Text(
        initials,
        style: context.textTheme.labelMedium?.copyWith(
          color: context.colors.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
