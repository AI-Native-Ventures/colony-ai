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
    final paper = _chatPaper(context);
    final filters = [
      (filter: _ChatFilter.all, label: 'All'),
      (filter: _ChatFilter.unread, label: 'Unread $unreadConversationCount'),
      (filter: _ChatFilter.direct, label: 'Direct'),
    ];

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(color: paper),
          child: Stack(
            fit: StackFit.passthrough,
            children: [
              if (_isChatDark(context))
                Positioned.fill(
                  child: const CustomPaint(painter: _DarkChatHeaderWash()),
                ),
              if (!_isChatDark(context))
                Positioned.fill(
                  child: Stack(
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: RadialGradient(
                            center: const Alignment(-0.65, -1),
                            radius: 1.4,
                            colors: [
                              const Color(0x88F4DFED),
                              const Color(0x00F4DFED),
                            ],
                          ),
                        ),
                      ),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: RadialGradient(
                            center: const Alignment(0.65, -0.8),
                            radius: 1.4,
                            colors: [
                              const Color(0x66E0E9FA),
                              const Color(0x00E0E9FA),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 25, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Chats',
                      style: context.textTheme.headlineSmall?.copyWith(
                        color: _chatInk(context),
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -1.1,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 17),
                    Container(
                      key: const ValueKey('channels-search-field'),
                      height: 42,
                      decoration: BoxDecoration(
                        color: _chatPaper(context),
                        border: Border.all(color: _chatLine(context)),
                        borderRadius: BorderRadius.circular(11),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Row(
                        children: [
                          Icon(
                            LucideIcons.search,
                            size: 17,
                            color: _chatMuted(context),
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: TextField(
                              controller: searchController,
                              cursorColor: _chatBlue(context),
                              style: context.textTheme.bodySmall?.copyWith(
                                color: _chatInk(context),
                                fontSize: 13,
                              ),
                              decoration: InputDecoration(
                                hintText: 'Find a conversation',
                                hintStyle: context.textTheme.bodySmall
                                    ?.copyWith(
                                      color: _chatMuted(context),
                                      fontSize: 13,
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
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final entry in filters)
                  Padding(
                    padding: const EdgeInsets.only(right: 5),
                    child: TextButton(
                      onPressed: () => onFilterChanged(entry.filter),
                      style: TextButton.styleFrom(
                        minimumSize: Size.zero,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 13,
                          vertical: 8,
                        ),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        backgroundColor: activeFilter == entry.filter
                            ? _chatSoft(context)
                            : Colors.transparent,
                        foregroundColor: activeFilter == entry.filter
                            ? _chatInk(context)
                            : _chatMuted(context),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(9),
                        ),
                      ),
                      child: Text(
                        entry.label,
                        style: context.textTheme.labelMedium?.copyWith(
                          fontSize: 12,
                          fontWeight: activeFilter == entry.filter
                              ? FontWeight.w700
                              : FontWeight.w400,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

const _darkChatHeaderWashColors = [
  Color(0x78F4DFED),
  Color(0x6BF4DFED),
  Color(0x64E0E9FA),
];

class _DarkChatHeaderWash extends CustomPainter {
  const _DarkChatHeaderWash();

  @override
  void paint(Canvas canvas, Size size) {
    final bounds = Offset.zero & size;
    canvas.saveLayer(bounds, Paint());
    canvas.drawRect(
      bounds,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: _darkChatHeaderWashColors,
          stops: [0, 0.5, 1],
        ).createShader(bounds),
    );
    canvas.drawRect(
      bounds,
      Paint()
        ..blendMode = BlendMode.dstIn
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white,
            Color(0xF2FFFFFF),
            Color(0xBFFFFFFF),
            Color(0x8CFFFFFF),
            Colors.transparent,
            Colors.transparent,
          ],
          stops: [0, 0.14, 0.32, 0.48, 0.64, 1],
        ).createShader(bounds),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _DarkChatHeaderWash oldDelegate) => false;
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
      displayedConversations
          .where(
            (c) =>
                !assignedChannelIds.contains(c.id) &&
                !starredChannelIds.contains(c.id),
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
          else ...[
            if (activeFilter.value != _ChatFilter.direct)
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
                title: 'CHANNELS',
                icon: LucideIcons.hash,
                showTopDivider: false,
                expanded: channelsExpanded.value,
                onToggle: () =>
                    channelsExpanded.value = !channelsExpanded.value,
                channels: ungroupedStreamChannels,
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
