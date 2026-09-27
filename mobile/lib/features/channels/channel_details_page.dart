part of 'channel_actions_sheet.dart';

const _channelMemberPreviewLimit = 3;
const _channelDetailsHeaderFrostScrollDistance = Grid.xxl;
const _channelDetailsHeaderFrostMaxBlurSigma = 20.0;
const _channelDetailsSectionPadding = Grid.twelve;

/// Opens the combined mobile channel settings page.
Future<bool?> showChannelDetailsPage({
  required BuildContext context,
  required Channel channel,
  required String? currentPubkey,
  required void Function(BuildContext context, String pubkey) onMemberTap,
  VoidCallback? openQuickActions,
  String? sectionId,
}) => Navigator.of(context).push<bool>(
  MaterialPageRoute<bool>(
    builder: (_) => ChannelDetailsPage(
      channel: channel,
      currentPubkey: currentPubkey,
      onMemberTap: onMemberTap,
      openQuickActions: openQuickActions,
      sectionId: sectionId,
    ),
  ),
);

/// Combined channel identity, membership, organization, and lifecycle page.
class ChannelDetailsPage extends HookConsumerWidget {
  const ChannelDetailsPage({
    super.key,
    required this.channel,
    required this.currentPubkey,
    required this.onMemberTap,
    this.openQuickActions,
    this.sectionId,
  });

  final Channel channel;
  final String? currentPubkey;
  final void Function(BuildContext context, String pubkey) onMemberTap;
  final VoidCallback? openQuickActions;
  final String? sectionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final displayedChannel = useState(channel);
    final resolvedChannel = displayedChannel.value;
    final scrollController = useScrollController();
    final headerFrostProgress = useState(0.0);
    final isJoining = useState(false);
    final isMuted =
        ref
            .watch(channelMutesProvider)
            .store
            .channels[resolvedChannel.id]
            ?.muted ==
        true;
    final isStarred =
        ref
            .watch(channelStarsProvider)
            .store
            .channels[resolvedChannel.id]
            ?.starred ==
        true;
    final membersAsync = ref.watch(channelMembersProvider(resolvedChannel.id));
    final members = membersAsync.asData?.value ?? const <ChannelMember>[];
    final agentOwnersAsync = ref.watch(agentOwnersProvider);
    final sectionState = ref.watch(channelSectionsProvider);
    final resolvedCurrentPubkey =
        currentPubkey?.toLowerCase() ??
        ref.watch(currentPubkeyProvider)?.toLowerCase();
    final currentMember = members.cast<ChannelMember?>().firstWhere(
      (member) => member?.pubkey.toLowerCase() == resolvedCurrentPubkey,
      orElse: () => null,
    );
    final ownsOwnerAgent =
        resolvedCurrentPubkey != null &&
        members.any(
          (member) =>
              member.isOwner &&
              agentOwnersAsync.value?[member.pubkey.toLowerCase()]
                      ?.toLowerCase() ==
                  resolvedCurrentPubkey,
        );
    final canManageLifecycle =
        currentMember?.isElevated == true || ownsOwnerAgent;
    final canEdit = canManageLifecycle && !resolvedChannel.isArchived;
    final canJoin =
        resolvedChannel.visibility == 'open' &&
        !resolvedChannel.isArchived &&
        !resolvedChannel.isMember;
    final canAddMembers =
        membersAsync.hasValue &&
        !membersAsync.isLoading &&
        !membersAsync.hasError &&
        !resolvedChannel.isArchived &&
        resolvedChannel.canAddMembers(currentMember?.role);
    final canArchive = !resolvedChannel.isArchived && canManageLifecycle;
    final canUnarchive = resolvedChannel.isArchived && canManageLifecycle;
    final canDelete =
        !resolvedChannel.isArchived &&
        (currentMember?.isOwner == true || ownsOwnerAgent);
    final lifecycleCapabilitiesLoading =
        membersAsync.isLoading || agentOwnersAsync.isLoading;
    final lifecycleCapabilitiesUnavailable =
        membersAsync.hasError || agentOwnersAsync.hasError;
    final previewMembers = members.take(_channelMemberPreviewLimit).toList();
    final userCache = ref.watch(userCacheProvider);
    final currentSectionId = sectionState.isReady
        ? sectionState.store.assignments[resolvedChannel.id]
        : sectionId;
    final previewPubkeyKey = previewMembers
        .map((member) => member.pubkey.toLowerCase())
        .join('|');

    useEffect(() {
      if (previewMembers.isNotEmpty) {
        ref
            .read(userCacheProvider.notifier)
            .preload(previewMembers.map((member) => member.pubkey).toList());
      }
      return null;
    }, [previewPubkeyKey]);

    useEffect(() {
      void updateHeaderFrost() {
        final nextFrostProgress = !scrollController.hasClients
            ? 0.0
            : (scrollController.offset /
                      _channelDetailsHeaderFrostScrollDistance)
                  .clamp(0.0, 1.0)
                  .toDouble();
        if ((headerFrostProgress.value - nextFrostProgress).abs() > 0.001) {
          headerFrostProgress.value = nextFrostProgress;
        }
      }

      scrollController.addListener(updateHeaderFrost);
      return () => scrollController.removeListener(updateHeaderFrost);
    }, [scrollController]);

    Future<void> openMembers() => showBuzzModalBottomSheet<void>(
      context: context,
      title: 'Members',
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => MembersSheet(
        channel: resolvedChannel,
        currentPubkey: resolvedCurrentPubkey,
      ),
    );

    Future<void> openAddMembers() async {
      final mediaQuery = MediaQuery.of(context);
      await showBuzzModalBottomSheet<bool>(
        context: context,
        title: 'Add members',
        isScrollControlled: true,
        showDragHandle: true,
        constraints: BoxConstraints(
          maxWidth: 640,
          maxHeight:
              mediaQuery.size.height - mediaQuery.viewPadding.top - Grid.xs,
        ),
        builder: (_) => AddChannelMembersSheet(
          channelId: resolvedChannel.id,
          existingPubkeys: {
            for (final member in members) member.pubkey.toLowerCase(),
          },
        ),
      );
    }

    Future<void> openManageChannel() async {
      final shouldClose = await showBuzzModalBottomSheet<bool>(
        context: context,
        title: 'Manage channel',
        isScrollControlled: true,
        showDragHandle: true,
        constraints: BoxConstraints(
          maxWidth: 640,
          maxHeight: MediaQuery.sizeOf(context).height * 0.9,
        ),
        builder: (_) => ManageChannelSheet(
          channel: resolvedChannel,
          canEditDetails: canEdit,
          onChannelUpdated: (updated) => displayedChannel.value = updated,
        ),
      );
      if (shouldClose == true && context.mounted) {
        Navigator.of(context).pop(true);
      }
    }

    void toggleStar() {
      final notifier = ref.read(channelStarsProvider.notifier);
      isStarred
          ? notifier.unstarChannel(resolvedChannel.id)
          : notifier.starChannel(resolvedChannel.id);
    }

    void toggleMute() {
      final notifier = ref.read(channelMutesProvider.notifier);
      isMuted
          ? notifier.unmuteChannel(resolvedChannel.id)
          : notifier.muteChannel(resolvedChannel.id);
    }

    Future<void> joinChannel() async {
      if (isJoining.value) return;
      isJoining.value = true;
      try {
        await ref.read(channelActionsProvider).joinChannel(resolvedChannel.id);
        if (context.mounted) Navigator.of(context).pop(false);
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Couldn’t join channel. Try again.')),
          );
        }
      } finally {
        isJoining.value = false;
      }
    }

    final usesNativeIosGlassBackButton =
        Navigator.canPop(context) &&
        Theme.of(context).platform == TargetPlatform.iOS;
    final channelTitle = _humanizedChannelName(resolvedChannel.name);
    return FrostedScaffold(
      appBar: FrostedAppBar(
        centerTitle: false,
        leading: usesNativeIosGlassBackButton
            ? IosGlassNavigationButton(
                key: const ValueKey('channel-details-ios-glass-back'),
                icon: IosGlassNavigationIcon.back,
                semanticLabel: 'Back',
                onPressed: () => Navigator.of(context).maybePop(),
                width: iosGlassChannelHeaderLeadingWidth,
                buttonCenterX: iosGlassChannelHeaderButtonCenterX,
              )
            : null,
        iconColor: context.mobileTokens.ink,
        gradient: context.appColors.companyWashGradient,
        actions: openQuickActions == null
            ? const []
            : [
                IconButton(
                  key: const ValueKey('channel-details-quick-actions'),
                  tooltip: 'Quick actions',
                  onPressed: openQuickActions,
                  style: IconButton.styleFrom(
                    foregroundColor: context.mobileTokens.ink,
                    backgroundColor: context.mobileTokens.paper,
                    side: BorderSide(color: context.mobileTokens.line),
                    shape: const CircleBorder(),
                  ),
                  icon: const Icon(LucideIcons.plus),
                ),
              ],
        frosted: headerFrostProgress.value > 0,
        frostedSurfaceOpacity: 0.5 * headerFrostProgress.value,
        frostedBlurSigma:
            _channelDetailsHeaderFrostMaxBlurSigma * headerFrostProgress.value,
        showBottomDivider: true,
        bottomDividerOpacity: 1,
        horizontalInset: Grid.xs - Grid.half,
        titleContentHeight: MobileLayoutTokens.appBarHeight,
        titleStyle: context.mobileTypography.companyHubTitle.copyWith(
          color: context.mobileTokens.ink,
        ),
        title: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              channelTitle,
              key: const ValueKey('channel-details-collapsed-title'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.mobileTypography.companyHubTitle.copyWith(
                color: context.mobileTokens.ink,
              ),
            ),
            Text(
              resolvedChannel.isForum ? 'Forum' : 'Client channel',
              style: context.mobileTypography.identityDetails.copyWith(
                color: context.mobileTokens.muted,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        key: const ValueKey('channel-details-page-list'),
        controller: scrollController,
        padding: EdgeInsets.only(
          top:
              frostedAppBarHeight(
                context,
                titleContentHeight: MobileLayoutTokens.appBarHeight,
              ) +
              Grid.xs,
          bottom: MediaQuery.viewPaddingOf(context).bottom + Grid.xs,
        ),
        children: [
          _ChannelDetailsHero(channel: resolvedChannel),
          Column(
            key: const ValueKey('channel-details-members-card'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Grid.gutter,
                  _channelDetailsSectionPadding,
                  Grid.gutter,
                  Grid.xxs,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'In this conversation',
                        style: context.textTheme.labelMedium?.copyWith(
                          color: context.colors.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    TextButton(
                      key: const ValueKey('channel-details-members-row'),
                      onPressed: openMembers,
                      style: TextButton.styleFrom(
                        minimumSize: Size.zero,
                        padding: EdgeInsets.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        foregroundColor: context.appColors.plum,
                      ),
                      child: Text(
                        'See all',
                        style: context.mobileTypography.identityDetails,
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
                child: Column(
                  children: [
                    if (membersAsync.isLoading && members.isEmpty)
                      const AppListRow(
                        icon: LucideIcons.loaderCircle,
                        title: 'Loading members…',
                        trailing: BuzzLoadingIndicator(
                          size: 20,
                          semanticLabel: 'Loading members',
                        ),
                      )
                    else if (membersAsync.hasError && members.isEmpty)
                      const AppListRow(
                        icon: LucideIcons.triangleAlert,
                        title: 'Members unavailable',
                      )
                    else
                      for (final member in previewMembers)
                        _ChannelMemberPreviewRow(
                          key: ValueKey(
                            'channel-details-member-${member.pubkey}',
                          ),
                          member: member,
                          currentPubkey: resolvedCurrentPubkey,
                          onMemberTap: onMemberTap,
                          displayName: userCache[member.pubkey.toLowerCase()]
                              ?.displayName,
                          avatarUrl:
                              userCache[member.pubkey.toLowerCase()]?.avatarUrl,
                        ),
                  ],
                ),
              ),
            ],
          ),
          AppListCard(
            key: const ValueKey('channel-details-channel-card'),
            verticalPadding: _channelDetailsSectionPadding,
            children: [
              if (canAddMembers)
                AppListRowRaw(
                  key: const ValueKey('channel-details-add-members-row'),
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: context.colors.surfaceContainer,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      LucideIcons.plus,
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
                  title: Text(
                    'Add members',
                    style: context.textTheme.bodyLarge,
                  ),
                  trailing: const _ChannelDetailsChevron(),
                  onTap: openAddMembers,
                  verticalPadding: Grid.xxs,
                ),
              AppListRow(
                icon: LucideIcons.folderInput,
                title: 'Move to section…',
                trailing: const _ChannelDetailsChevron(),
                onTap: () async {
                  await _showMoveSectionSheet(
                    context,
                    ref,
                    channel: resolvedChannel,
                    sectionId: currentSectionId,
                  );
                },
              ),
              AppListRow(
                icon: LucideIcons.copy,
                title: 'Copy channel name',
                onTap: () {
                  copyToClipboard(
                    context,
                    resolvedChannel.name,
                    message: 'Channel name copied to clipboard',
                  );
                },
              ),
              AppListRow(
                icon: LucideIcons.hash,
                title: 'Copy channel ID',
                onTap: () {
                  copyToClipboard(
                    context,
                    resolvedChannel.id,
                    message: 'Channel ID copied to clipboard',
                  );
                },
              ),
            ],
          ),
          Padding(
            key: const ValueKey('channel-details-actions'),
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              _channelDetailsSectionPadding,
              Grid.gutter,
              _channelDetailsSectionPadding,
            ),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-star-action'),
                      icon: null,
                      iconWidget: LucideStarIcon(
                        filled: isStarred,
                        color: isStarred
                            ? context.colors.primary
                            : context.colors.onSurface,
                      ),
                      label: isStarred ? 'Unstar' : 'Star',
                      onTap: toggleStar,
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-mute-action'),
                      icon: isMuted ? LucideIcons.bell : LucideIcons.bellOff,
                      iconColor: isMuted ? context.colors.primary : null,
                      label: isMuted ? 'Unmute' : 'Mute',
                      onTap: toggleMute,
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-edit-action'),
                      icon: LucideIcons.pencil,
                      label: 'Edit',
                      isEnabled: canEdit,
                      onTap: openManageChannel,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (resolvedChannel.isMember ||
              canJoin ||
              lifecycleCapabilitiesLoading ||
              lifecycleCapabilitiesUnavailable ||
              canArchive ||
              canUnarchive ||
              canDelete)
            AppListCard(
              key: const ValueKey('channel-details-lifecycle-card'),
              verticalPadding: _channelDetailsSectionPadding,
              children: [
                if (canJoin)
                  AppListRow(
                    icon: LucideIcons.logIn,
                    title: isJoining.value
                        ? 'Joining channel…'
                        : 'Join channel',
                    onTap: isJoining.value ? null : joinChannel,
                  ),
                if (resolvedChannel.isMember && !resolvedChannel.isArchived)
                  AppListRow(
                    icon: LucideIcons.logOut,
                    title: 'Leave channel',
                    titleColor: context.colors.error,
                    onTap: () => _confirmAndRun(
                      context,
                      ref,
                      title: 'Leave #${resolvedChannel.name}?',
                      body: 'You’ll stop receiving messages from this channel.',
                      confirmLabel: 'Leave',
                      action: () => ref
                          .read(channelActionsProvider)
                          .leaveChannel(resolvedChannel.id),
                    ),
                  ),
                if (lifecycleCapabilitiesLoading)
                  const AppListRow(
                    icon: LucideIcons.loaderCircle,
                    title: 'Loading channel actions…',
                    trailing: BuzzLoadingIndicator(
                      size: 20,
                      semanticLabel: 'Loading channel actions',
                    ),
                  )
                else if (lifecycleCapabilitiesUnavailable)
                  const AppListRow(
                    icon: LucideIcons.triangleAlert,
                    title: 'Channel actions unavailable',
                  )
                else ...[
                  if (canArchive)
                    AppListRow(
                      icon: LucideIcons.archive,
                      title: 'Archive channel',
                      onTap: () => _confirmAndRun(
                        context,
                        ref,
                        title: 'Archive #${resolvedChannel.name}?',
                        body: 'The channel will become read-only.',
                        confirmLabel: 'Archive',
                        action: () => ref
                            .read(channelActionsProvider)
                            .archiveChannel(resolvedChannel.id),
                      ),
                    ),
                  if (canUnarchive)
                    AppListRow(
                      icon: LucideIcons.archiveRestore,
                      title: 'Unarchive channel',
                      onTap: () => _confirmAndRun(
                        context,
                        ref,
                        title: 'Unarchive #${resolvedChannel.name}?',
                        body: 'The channel will become active again.',
                        confirmLabel: 'Unarchive',
                        action: () => ref
                            .read(channelActionsProvider)
                            .unarchiveChannel(resolvedChannel.id),
                      ),
                    ),
                  if (canDelete)
                    AppListRow(
                      icon: LucideIcons.trash2,
                      title: 'Delete channel',
                      titleColor: context.colors.error,
                      onTap: () => _confirmAndRun(
                        context,
                        ref,
                        title: 'Delete #${resolvedChannel.name}?',
                        body:
                            'This permanently deletes the channel and cannot be undone.',
                        confirmLabel: 'Delete',
                        action: () => ref
                            .read(channelActionsProvider)
                            .deleteChannel(resolvedChannel.id),
                      ),
                    ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}

class _ChannelDetailsHero extends StatelessWidget {
  const _ChannelDetailsHero({required this.channel});

  final Channel channel;

  @override
  Widget build(BuildContext context) {
    final description = channel.description.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        _channelDetailsSectionPadding,
      ),
      child: Container(
        key: const ValueKey('channel-details-hero'),
        width: double.infinity,
        padding: const EdgeInsets.all(Grid.xs),
        decoration: BoxDecoration(
          gradient: context.appColors.companyWashGradient,
          borderRadius: BorderRadius.circular(Radii.companyCard),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              channel.isForum ? channel.name : '# ${channel.name}',
              key: const ValueKey('channel-details-name'),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: context.mobileTypography.companyHubTitle.copyWith(
                color: context.mobileTokens.ink,
              ),
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: Grid.half),
              Text(
                description,
                key: const ValueKey('channel-details-description'),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: context.mobileTypography.identityDetails.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ChannelMemberPreviewRow extends StatelessWidget {
  const _ChannelMemberPreviewRow({
    super.key,
    required this.member,
    required this.currentPubkey,
    required this.onMemberTap,
    required this.displayName,
    required this.avatarUrl,
  });

  final ChannelMember member;
  final String? currentPubkey;
  final void Function(BuildContext context, String pubkey) onMemberTap;
  final String? displayName;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final isSelf = member.pubkey.toLowerCase() == currentPubkey?.toLowerCase();
    final hasName = displayName?.trim().isNotEmpty == true;
    final label = isSelf
        ? 'You'
        : hasName
        ? displayName!.trim()
        : member.labelFor(currentPubkey);
    // Self/named initials come from the visible label; unnamed members stay
    // keyed to the hex public key so the compact-npub label doesn't render
    // `N` for everyone.
    final pubkeyInitial = member.pubkey.isNotEmpty
        ? member.pubkey[0].toUpperCase()
        : '?';
    final initials = isSelf || hasName
        ? _channelMemberInitials(label, fallback: pubkeyInitial)
        : pubkeyInitial;
    final roleLabel = _channelMemberRoleLabel(member.role);
    final identityKind = member.isBot
        ? IdentityKind.agent
        : IdentityKind.person;
    void openMemberProfile() => onMemberTap(context, member.pubkey);
    return Semantics(
      container: true,
      button: true,
      label: '$label, $roleLabel, ${member.isBot ? 'AI agent' : 'Person'}',
      onTap: openMemberProfile,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: openMemberProfile,
          child: ExcludeSemantics(
            child: IdentityRow(
              name: label,
              details: roleLabel,
              initials: initials,
              kind: identityKind,
              imageUrl: avatarUrl,
            ),
          ),
        ),
      ),
    );
  }
}

String _channelMemberInitials(String label, {required String fallback}) {
  final words = label
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  final initials = words.take(2).map((word) => word[0].toUpperCase()).join();
  return initials.isEmpty ? fallback : initials;
}

String _channelMemberRoleLabel(String role) {
  if (role == 'bot') return 'Agent';
  if (role.isEmpty) return 'Member';
  return '${role[0].toUpperCase()}${role.substring(1)}';
}

String _humanizedChannelName(String name) {
  final words = name.replaceAll(RegExp(r'[-_]'), ' ').split(RegExp(r'\s+'));
  return words
      .where((word) => word.isNotEmpty)
      .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
      .join(' ');
}

class _ChannelDetailsChevron extends StatelessWidget {
  const _ChannelDetailsChevron();

  @override
  Widget build(BuildContext context) => Icon(
    LucideIcons.chevronRight,
    size: 18,
    color: context.colors.onSurfaceVariant,
  );
}
