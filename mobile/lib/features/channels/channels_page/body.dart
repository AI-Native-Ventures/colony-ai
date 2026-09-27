part of '../channels_page.dart';

class _ChannelsBody extends StatelessWidget {
  final List<Channel>? channels;
  final AsyncValue<List<Channel>> channelsAsync;
  final bool showError;
  final SessionStatus sessionStatus;
  final bool showConnectionSkeleton;
  final String? currentPubkey;
  final double topSectionHeight;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Channel channel) onSelectChannel;
  final VoidCallback onOpenQuickActions;
  final MobileRouteRegistry? routeRegistry;

  const _ChannelsBody({
    required this.channels,
    required this.channelsAsync,
    required this.showError,
    required this.sessionStatus,
    required this.showConnectionSkeleton,
    required this.currentPubkey,
    required this.topSectionHeight,
    required this.scrollController,
    required this.onRefresh,
    required this.onSelectChannel,
    required this.onOpenQuickActions,
    required this.routeRegistry,
  });

  @override
  Widget build(BuildContext context) {
    final barHeight = topSectionHeight;
    final loadedChannels = channels;
    final loading =
        showConnectionSkeleton || (loadedChannels == null && !showError);
    final content = showError && channelsAsync.hasError
        ? Padding(
            padding: EdgeInsets.only(top: barHeight),
            child: _ErrorView(error: channelsAsync.error!, onRetry: onRefresh),
          )
        : loadedChannels == null
        ? const SizedBox.shrink()
        : BeeRefreshIndicator(
            edgeOffset: barHeight,
            onRefresh: onRefresh,
            child: CustomScrollView(
              controller: scrollController,
              // Transparent list gaps must remain hit-testable so a new drag
              // can interrupt ballistic scrolling. The app bar is painted
              // later and retains its community and profile controls.
              hitTestBehavior: HitTestBehavior.translucent,
              slivers: [
                SliverToBoxAdapter(child: SizedBox(height: barHeight)),
                DecoratedSliver(
                  decoration: BoxDecoration(
                    color: _chatPaper(context),
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(Radii.dialog),
                    ),
                  ),
                  sliver: _SliverChannelsList(
                    channels: loadedChannels,
                    currentPubkey: currentPubkey,
                    onSelectChannel: onSelectChannel,
                    onOpenQuickActions: onOpenQuickActions,
                    routeRegistry: routeRegistry,
                  ),
                ),
              ],
            ),
          );

    return SkeletonReveal(
      loading: loading,
      shimmerEnabled: sessionStatus != SessionStatus.disconnected,
      skeleton: _ChannelsSkeleton(
        channels: loadedChannels,
        topInset: barHeight,
        status: sessionStatus,
      ),
      content: content,
    );
  }
}

class _ChatListToolbar extends StatelessWidget {
  const _ChatListToolbar({
    required this.searchController,
    required this.activeFilter,
    required this.unreadConversationCount,
    required this.onFilterChanged,
  });

  final TextEditingController searchController;
  final _ChatFilter activeFilter;
  final int unreadConversationCount;
  final ValueChanged<_ChatFilter> onFilterChanged;

  @override
  Widget build(BuildContext context) {
    final filters = [
      (filter: _ChatFilter.all, label: 'All'),
      (filter: _ChatFilter.channels, label: 'Channels'),
      (filter: _ChatFilter.forums, label: 'Forums'),
      (filter: _ChatFilter.direct, label: 'DMs'),
      (
        filter: _ChatFilter.unread,
        label: unreadConversationCount == 0
            ? 'Unread'
            : 'Unread $unreadConversationCount',
      ),
    ];

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            MobileLayoutTokens.contentGutter,
            Grid.quarter,
            MobileLayoutTokens.contentGutter,
            0,
          ),
          child: Container(
            key: const ValueKey('channels-search-field'),
            height: MobileLayoutTokens.minimumTapTarget,
            decoration: BoxDecoration(
              color: context.mobileTokens.paper,
              border: Border.all(color: context.mobileTokens.line),
              borderRadius: BorderRadius.circular(Radii.field),
            ),
            padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
            child: Row(
              children: [
                Icon(
                  LucideIcons.search,
                  size: Grid.sm,
                  color: context.mobileTokens.muted,
                ),
                const SizedBox(width: Grid.half),
                Expanded(
                  child: TextField(
                    controller: searchController,
                    cursorColor: context.appColors.plum,
                    style: context.mobileTypography.body.copyWith(
                      color: context.mobileTokens.ink,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Find a conversation',
                      hintStyle: context.mobileTypography.body.copyWith(
                        color: context.mobileTokens.muted,
                      ),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      disabledBorder: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(
            horizontal: MobileLayoutTokens.contentGutter,
            vertical: Grid.xs,
          ),
          child: Row(
            children: [
              for (final entry in filters)
                Padding(
                  padding: const EdgeInsets.only(right: Grid.half),
                  child: TextButton(
                    key: ValueKey('conversation-filter-${entry.filter.name}'),
                    onPressed: () => onFilterChanged(entry.filter),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(
                        0,
                        MobileLayoutTokens.minimumTapTarget,
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      backgroundColor: activeFilter == entry.filter
                          ? context.mobileTokens.actionSoft
                          : context.mobileTokens.paper,
                      foregroundColor: activeFilter == entry.filter
                          ? context.mobileTokens.onActionSoft
                          : context.mobileTokens.muted,
                      side: BorderSide(color: context.mobileTokens.line),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.tapTarget),
                      ),
                    ),
                    child: Text(
                      entry.label,
                      style: context.mobileTypography.metadata.copyWith(
                        fontWeight: activeFilter == entry.filter
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SliverChannelsList extends HookConsumerWidget {
  final List<Channel> channels;
  final String? currentPubkey;
  final Future<void> Function(Channel channel) onSelectChannel;
  final VoidCallback onOpenQuickActions;
  final MobileRouteRegistry? routeRegistry;

  const _SliverChannelsList({
    required this.channels,
    required this.currentPubkey,
    required this.onSelectChannel,
    required this.onOpenQuickActions,
    required this.routeRegistry,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final searchController = useTextEditingController();
    final searchQuery = useState('');
    final activeFilter = useState(_ChatFilter.all);
    useEffect(() {
      void syncSearch() => searchQuery.value = searchController.text;
      searchController.addListener(syncSearch);
      return () => searchController.removeListener(syncSearch);
    }, [searchController]);

    final readState = ref.watch(readStateProvider);
    final sectionsState = ref.watch(channelSectionsProvider);
    final mutesState = ref.watch(channelMutesProvider);
    final mutedChannelIds = {
      for (final entry in mutesState.store.channels.entries)
        if (entry.value.muted) entry.key,
    };
    final starsState = ref.watch(channelStarsProvider);
    final starredChannelIds = {
      for (final entry in starsState.store.channels.entries)
        if (entry.value.starred) entry.key,
    };
    final visibleChannels = channels
        .where((channel) => channel.isMember && !channel.isArchived)
        .toList();
    final starredExpanded = useState(true);
    final channelsExpanded = useState(true);
    final dmsExpanded = useState(true);
    final sortState = ref.watch(channelSortProvider);
    final initialSeedComplete = useState(false);
    final seededPubkey = useRef<String?>(null);
    final seedCompleteForPubkey =
        seededPubkey.value == readState.pubkey && initialSeedComplete.value;

    useEffect(() {
      if (!readState.isReady) {
        return null;
      }

      return deferReadStateUpdate(context, () {
        if (seededPubkey.value != readState.pubkey) {
          seededPubkey.value = readState.pubkey;
          initialSeedComplete.value = false;
        }

        if (initialSeedComplete.value) {
          return;
        }

        final notifier = ref.read(readStateProvider.notifier);
        for (final channel in visibleChannels) {
          if (readState.effectiveTimestamp(channel.id) != null) {
            continue;
          }

          final lastMessageAt = dateTimeToUnixSeconds(channel.lastMessageAt);
          if (lastMessageAt != null) {
            notifier.seedContextRead(channel.id, lastMessageAt);
          }
        }
        initialSeedComplete.value = true;
      });
    }, [readState.isReady, readState.pubkey, visibleChannels]);

    final unreadState = _computeUnreadChannelState(
      channels: visibleChannels,
      readState: readState,
      channelsNotifier: ref.read(channelsProvider.notifier),
    );
    final unreadChannelIds = {
      for (final channelId in unreadState.ids)
        if (seedCompleteForPubkey ||
            readState.effectiveTimestamp(channelId) != null)
          channelId,
    };
    final query = searchQuery.value.trim().toLowerCase();
    final displayedChannels = visibleChannels.where((channel) {
      if (activeFilter.value == _ChatFilter.unread &&
          !unreadChannelIds.contains(channel.id)) {
        return false;
      }
      if (activeFilter.value == _ChatFilter.channels &&
          (channel.isDm || channel.isForum)) {
        return false;
      }
      if (activeFilter.value == _ChatFilter.forums && !channel.isForum) {
        return false;
      }
      if (activeFilter.value == _ChatFilter.direct && !channel.isDm) {
        return false;
      }
      if (query.isEmpty) return true;
      final name = channel.isDm
          ? resolveDmChannelDisplayLabel(channel, currentPubkey: currentPubkey)
          : channel.name;
      return '$name ${channel.lastMessageContent ?? ''}'.toLowerCase().contains(
        query,
      );
    }).toList();
    final displayedConversations = displayedChannels
        .where((channel) => !channel.isDm)
        .toList();
    final displayedForums = displayedChannels
        .where((channel) => channel.isForum)
        .toList();
    final displayedStreamChannels = displayedChannels
        .where((channel) => !channel.isDm && !channel.isForum)
        .toList();
    final displayedDms = sortDmChannelsByDisplayLabel(
      displayedChannels.where((channel) => channel.isDm),
      currentPubkey: currentPubkey,
    );
    // Build sorted user-defined sections and compute which stream channels
    // belong to each section. Channels not assigned to any valid section fall
    // through to the built-in "Channels" list.
    final userSections = sectionsState.store.sections.toList()
      ..sort((a, b) => a.order.compareTo(b.order));
    final sectionAssignments = sectionsState.store.assignments;
    final validSectionIds = {for (final s in userSections) s.id};
    final assignedChannelIds = {
      for (final entry in sectionAssignments.entries)
        if (validSectionIds.contains(entry.value)) entry.key,
    };
    // Starred is exclusive: a starred channel lives only in the Starred section,
    // not in its custom section or the default Channels list.
    final starredStreamChannels = sortChannelsForList(
      displayedConversations
          .where((c) => starredChannelIds.contains(c.id))
          .toList(),
      sortState.sortModeFor('starred'),
    );
    final ungroupedStreamChannels = sortChannelsForList(
      displayedStreamChannels
          .where(
            (c) =>
                !assignedChannelIds.contains(c.id) &&
                !starredChannelIds.contains(c.id),
          )
          .toList(),
      sortState.sortModeFor('channels'),
    );
    final ungroupedForums = sortChannelsForList(
      displayedForums
          .where(
            (channel) =>
                !assignedChannelIds.contains(channel.id) &&
                !starredChannelIds.contains(channel.id),
          )
          .toList(),
      sortState.sortModeFor('channels'),
    );
    // DMs default to the display-label alphabetical order (labels can differ
    // from channel names); Recent mode reorders by last message time.
    final sortedDmChannels =
        sortState.sortModeFor('dms') == ChannelSortMode.recent
        ? sortChannelsForList(displayedDms, ChannelSortMode.recent)
        : displayedDms;
    final recentChannels = sortChannelsForList(
      displayedChannels.where((channel) => !channel.isDm).toList(),
      sortState.store.groups['channels'] ?? ChannelSortMode.recent,
    );
    final recentDms = sortChannelsForList(
      displayedDms,
      sortState.store.groups['dms'] ?? ChannelSortMode.recent,
    );
    final recentConversations = [...recentChannels, ...recentDms];

    final liveSectionIds = [for (final s in userSections) s.id];
    void setSortMode(String groupKey, ChannelSortMode mode) {
      ref
          .read(channelSortProvider.notifier)
          .setSortModeFor(groupKey, mode, liveSectionIds: liveSectionIds);
    }

    final sectionExpandedStates = useState<Map<String, bool>>({});

    bool sectionExpanded(String sectionId) =>
        sectionExpandedStates.value[sectionId] ?? true;

    void toggleSection(String sectionId) {
      sectionExpandedStates.value = {
        ...sectionExpandedStates.value,
        sectionId: !sectionExpanded(sectionId),
      };
    }

    return SliverPadding(
      padding: EdgeInsets.only(
        top: 0,
        bottom: MediaQuery.paddingOf(context).bottom,
      ),
      sliver: SliverList.list(
        children: [
          _ChatListToolbar(
            searchController: searchController,
            activeFilter: activeFilter.value,
            unreadConversationCount: unreadChannelIds.length,
            onFilterChanged: (filter) => activeFilter.value = filter,
          ),
          if (visibleChannels.isEmpty &&
              query.isEmpty &&
              activeFilter.value == _ChatFilter.all)
            const _EmptyState()
          else if (displayedChannels.isEmpty)
            const SizedBox.shrink()
          else if (starredStreamChannels.isEmpty && userSections.isEmpty)
            for (final channel in recentConversations)
              _ChannelTile(
                channel: channel,
                isUnread: unreadChannelIds.contains(channel.id),
                isMuted: mutedChannelIds.contains(channel.id),
                currentPubkey: currentPubkey,
                sectionId: sectionAssignments[channel.id],
                onTap: () => onSelectChannel(channel),
                onMarkRead: () {
                  final timestamp = dateTimeToUnixSeconds(
                    channel.lastMessageAt,
                  );
                  if (timestamp == null) return;
                  ref
                      .read(readStateProvider.notifier)
                      .markContextRead(
                        channel.id,
                        timestamp,
                        clearForcedMessages: true,
                      );
                  ref
                      .read(channelsProvider.notifier)
                      .clearObservedUnreadCoveredByRead(channel.id, timestamp);
                },
              )
          else ...[
            if (activeFilter.value != _ChatFilter.direct &&
                activeFilter.value != _ChatFilter.forums)
              _ChannelSection(
                title: 'PINNED',
                icon: LucideIcons.star,
                showTopDivider: false,
                expanded: starredExpanded.value,
                onToggle: () => starredExpanded.value = !starredExpanded.value,
                channels: starredStreamChannels,
                unreadChannelIds: unreadChannelIds,
                mutedChannelIds: mutedChannelIds,
                currentPubkey: currentPubkey,
                emptyLabel: '',
                sortMode: sortState.sortModeFor('starred'),
                onSortModeChange: (mode) => setSortMode('starred', mode),
                onSelectChannel: onSelectChannel,
                simpleStyle: true,
                onAdd: onOpenQuickActions,
              ),
            for (final section
                in activeFilter.value == _ChatFilter.direct
                    ? const <ChannelSection>[]
                    : userSections)
              _CustomChannelSection(
                section: section,
                channels: sortChannelsForList(
                  displayedConversations
                      .where(
                        (c) =>
                            sectionAssignments[c.id] == section.id &&
                            !starredChannelIds.contains(c.id),
                      )
                      .toList(),
                  sortState.sortModeFor(sectionSortGroupKey(section.id)),
                ),
                unreadChannelIds: unreadChannelIds,
                mutedChannelIds: mutedChannelIds,
                currentPubkey: currentPubkey,
                expanded: sectionExpanded(section.id),
                isFirst: userSections.first.id == section.id,
                isLast: userSections.last.id == section.id,
                showTopDivider:
                    starredStreamChannels.isNotEmpty ||
                    userSections.first.id != section.id,
                onToggle: () => toggleSection(section.id),
                onRename: () async {
                  final name = await showBuzzDialog<String>(
                    context: context,
                    builder: (_) => _SectionNameDialog(
                      title: 'Rename Section',
                      confirmLabel: 'Rename',
                      initialValue: section.name,
                    ),
                  );
                  if (name != null && name.isNotEmpty) {
                    ref
                        .read(channelSectionsProvider.notifier)
                        .renameSection(section.id, name);
                  }
                },
                onDelete: () async {
                  final confirmed = await showBuzzDialog<bool>(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: Text('Delete "${section.name}"?'),
                      content: const Text(
                        'Channels in this section will move back to the main list.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Cancel'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: Text(
                            'Delete',
                            style: TextStyle(color: context.colors.error),
                          ),
                        ),
                      ],
                    ),
                  );
                  if (confirmed == true) {
                    ref
                        .read(channelSectionsProvider.notifier)
                        .deleteSection(section.id);
                  }
                },
                onMoveUp: () => ref
                    .read(channelSectionsProvider.notifier)
                    .moveSectionUp(section.id),
                onMoveDown: () => ref
                    .read(channelSectionsProvider.notifier)
                    .moveSectionDown(section.id),
                sortMode: sortState.sortModeFor(
                  sectionSortGroupKey(section.id),
                ),
                onSortModeChange: (mode) =>
                    setSortMode(sectionSortGroupKey(section.id), mode),
                onSelectChannel: onSelectChannel,
                onMarkChannelRead: (channel) {
                  final ts = dateTimeToUnixSeconds(channel.lastMessageAt);
                  if (ts != null) {
                    ref
                        .read(readStateProvider.notifier)
                        .markContextRead(
                          channel.id,
                          ts,
                          clearForcedMessages: true,
                        );
                    ref
                        .read(channelsProvider.notifier)
                        .clearObservedUnreadCoveredByRead(channel.id, ts);
                  }
                },
              ),
            if (activeFilter.value != _ChatFilter.direct)
              _ChannelSection(
                title: activeFilter.value == _ChatFilter.forums
                    ? 'FORUMS'
                    : 'CHANNELS',
                icon: activeFilter.value == _ChatFilter.forums
                    ? LucideIcons.fileText
                    : LucideIcons.hash,
                showTopDivider: false,
                expanded: channelsExpanded.value,
                onToggle: () =>
                    channelsExpanded.value = !channelsExpanded.value,
                channels: activeFilter.value == _ChatFilter.forums
                    ? ungroupedForums
                    : [...ungroupedStreamChannels, ...ungroupedForums],
                unreadChannelIds: unreadChannelIds,
                mutedChannelIds: mutedChannelIds,
                currentPubkey: currentPubkey,
                emptyLabel: '',
                sortMode: sortState.sortModeFor('channels'),
                onSortModeChange: (mode) => setSortMode('channels', mode),
                onSelectChannel: onSelectChannel,
                simpleStyle: true,
                expandedTrailingPadding: 0,
              ),
            if (activeFilter.value == _ChatFilter.direct ||
                activeFilter.value == _ChatFilter.all ||
                activeFilter.value == _ChatFilter.unread)
              _ChannelSection(
                title: 'DIRECT MESSAGES',
                icon: LucideIcons.messagesSquare,
                showTopDivider: false,
                expanded: dmsExpanded.value,
                onToggle: () => dmsExpanded.value = !dmsExpanded.value,
                channels: sortedDmChannels,
                unreadChannelIds: unreadChannelIds,
                mutedChannelIds: mutedChannelIds,
                currentPubkey: currentPubkey,
                emptyLabel: 'No direct messages yet',
                sortMode: sortState.sortModeFor('dms'),
                onSortModeChange: (mode) => setSortMode('dms', mode),
                onSelectChannel: onSelectChannel,
                simpleStyle: true,
                simpleHeaderTopPadding: 5,
              ),
          ],
        ],
      ),
    );
  }
}
