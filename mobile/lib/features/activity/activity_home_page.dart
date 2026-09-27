import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import 'activity_provider.dart';
import 'feed_item.dart';
import 'inbox_item.dart';

enum ActivityHomeSection { forYou, updates }

typedef ActivityUpdatesPageBuilder =
    Widget Function(BuildContext context, bool showPublishedNotice);

class ActivityHomePage extends HookConsumerWidget {
  const ActivityHomePage({
    required this.onOpenItem,
    required this.updatesPageBuilder,
    this.tabReselection,
    super.key,
  });

  final ValueChanged<FeedItem> onOpenItem;
  final ActivityUpdatesPageBuilder updatesPageBuilder;
  final ValueListenable<int>? tabReselection;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = useState(ActivityHomeSection.forYou);
    final feed = ref.watch(activityProvider);
    final items = [...ref.watch(inboxItemsProvider)]
      ..sort((left, right) {
        final actionOrder = (right.isActionRequired ? 1 : 0).compareTo(
          left.isActionRequired ? 1 : 0,
        );
        if (actionOrder != 0) return actionOrder;
        return right.latestActivityAt.compareTo(left.latestActivityAt);
      });
    final scrollController = useScrollController();
    final reducedMotion = MediaQuery.disableAnimationsOf(context);

    useEffect(() {
      final reselection = tabReselection;
      if (reselection == null) return null;
      void scrollToStart() {
        if (!scrollController.hasClients) return;
        if (reducedMotion) {
          scrollController.jumpTo(scrollController.position.minScrollExtent);
        } else {
          scrollController.animateTo(
            scrollController.position.minScrollExtent,
            duration: const Duration(milliseconds: 240),
            curve: Curves.easeOutCubic,
          );
        }
      }

      reselection.addListener(scrollToStart);
      return () => reselection.removeListener(scrollToStart);
    }, [tabReselection, scrollController, reducedMotion]);

    final pubkeys = items.map((item) => item.item.pubkey).toSet().toList();
    useEffect(() {
      if (pubkeys.isEmpty) return null;
      ref.read(userCacheProvider.notifier).preload(pubkeys);
      return null;
    }, [pubkeys.join('\u0000')]);

    return ColoredBox(
      color: context.mobileTokens.paper,
      child: Column(
        children: [
          SafeArea(
            bottom: false,
            child: _ActivityHeader(
              onBack: () => unawaited(Navigator.of(context).maybePop()),
            ),
          ),
          _ActivityTabs(
            selected: selected.value,
            onSelected: (next) => selected.value = next,
          ),
          Expanded(
            child: selected.value == ActivityHomeSection.updates
                ? updatesPageBuilder(context, false)
                : _ActivityContent(
                    items: items,
                    feed: feed,
                    scrollController: scrollController,
                    onOpenItem: onOpenItem,
                    onRetry: () =>
                        ref.read(activityProvider.notifier).refresh(),
                  ),
          ),
        ],
      ),
    );
  }
}

class _ActivityHeader extends StatelessWidget {
  const _ActivityHeader({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Back to Today',
            onTap: onBack,
            child: ExcludeSemantics(
              child: Material(
                color: tokens.paper,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.button),
                  side: BorderSide(color: tokens.line),
                ),
                child: InkWell(
                  key: const ValueKey('activity-back-to-today'),
                  customBorder: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.button),
                  ),
                  onTap: onBack,
                  child: SizedBox(
                    width: 42,
                    height: 42,
                    child: Icon(
                      LucideIcons.chevronLeft,
                      size: 20,
                      color: tokens.ink,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: Grid.xxs),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Updates',
                  style: context.textTheme.titleMedium?.copyWith(
                    color: tokens.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.35,
                  ),
                ),
                Text(
                  'The company, moving together',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: tokens.muted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityTabs extends StatelessWidget {
  const _ActivityTabs({required this.selected, required this.onSelected});

  final ActivityHomeSection selected;
  final ValueChanged<ActivityHomeSection> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
      child: Align(
        alignment: Alignment.topLeft,
        child: Padding(
          padding: const EdgeInsets.only(top: 14),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ActivityTab(
                label: 'For you',
                selected: selected == ActivityHomeSection.forYou,
                onTap: () => onSelected(ActivityHomeSection.forYou),
              ),
              _ActivityTab(
                label: 'Team updates',
                selected: selected == ActivityHomeSection.updates,
                onTap: () => onSelected(ActivityHomeSection.updates),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivityTab extends StatelessWidget {
  const _ActivityTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? tokens.soft : Colors.transparent,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Text(
              label,
              style: context.textTheme.labelMedium?.copyWith(
                color: selected ? tokens.ink : tokens.muted,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ActivityContent extends StatelessWidget {
  const _ActivityContent({
    required this.items,
    required this.feed,
    required this.scrollController,
    required this.onOpenItem,
    required this.onRetry,
  });

  final List<InboxItem> items;
  final AsyncValue<HomeFeedResponse> feed;
  final ScrollController scrollController;
  final ValueChanged<FeedItem> onOpenItem;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      if (feed.isLoading) {
        return const Center(child: CircularProgressIndicator.adaptive());
      }
      if (feed.hasError) {
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Failed to load activity',
                style: context.textTheme.bodyMedium?.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
              const SizedBox(height: Grid.xxs),
              TextButton.icon(
                onPressed: () => unawaited(onRetry()),
                icon: const Icon(LucideIcons.refreshCcw, size: 16),
                label: const Text('Retry'),
              ),
            ],
          ),
        );
      }
      return Center(
        child: Text(
          'No activity yet',
          style: context.textTheme.bodyMedium?.copyWith(
            color: context.mobileTokens.muted,
          ),
        ),
      );
    }

    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(Grid.gutter, 0, Grid.gutter, Grid.xl),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final inboxItem = items[index];
        final item = inboxItem.item;
        return _ActivityRow(
          item: item,
          count: inboxItem.groupItems.length,
          onTap: () => onOpenItem(item),
        );
      },
    );
  }
}

class _ActivityRow extends ConsumerWidget {
  const _ActivityRow({
    required this.item,
    required this.count,
    required this.onTap,
  });

  final FeedItem item;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final normalizedPubkey = item.pubkey.toLowerCase();
    final profile = ref.watch(
      userCacheProvider.select((cache) => cache[normalizedPubkey]),
    );
    final known =
        profile ?? ref.read(userCacheProvider.notifier).get(normalizedPubkey);
    final author =
        _firstName(known?.displayName) ?? shortPubkey(normalizedPubkey);
    final title = _title(item, author);
    final subtitle = _subtitle(item, author);
    final displayTime = DateFormat(
      'HH:mm',
    ).format(DateTime.fromMillisecondsSinceEpoch(item.createdAt * 1000));
    final showCount =
        item.category == 'mention' ||
        item.category == 'needs_action' ||
        isThreadReply(item.tags);

    return Semantics(
      button: true,
      label: '$title. $subtitle. $displayTime',
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 68),
            padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
            child: Row(
              children: [
                _AuthorInitials(
                  initials: known?.initials ?? _initial(item.pubkey),
                  agent: item.category == 'agent_activity',
                ),
                const SizedBox(width: Grid.xxs),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: tokens.ink,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: Grid.half),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.textTheme.bodySmall?.copyWith(
                          color: tokens.muted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Grid.xxs),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      displayTime,
                      style: context.textTheme.labelSmall?.copyWith(
                        color: tokens.muted,
                        fontSize: 9,
                      ),
                    ),
                    if (showCount) ...[
                      const SizedBox(height: Grid.half),
                      Container(
                        constraints: const BoxConstraints(minWidth: 20),
                        height: 20,
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(
                          horizontal: Grid.half,
                        ),
                        decoration: BoxDecoration(
                          color: tokens.action,
                          borderRadius: BorderRadius.circular(Radii.sm),
                        ),
                        child: Text(
                          '$count',
                          style: context.textTheme.labelSmall?.copyWith(
                            color: Theme.of(context).colorScheme.onPrimary,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthorInitials extends StatelessWidget {
  const _AuthorInitials({required this.initials, required this.agent});

  final String initials;
  final bool agent;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: agent ? const Color(0xffe4ede5) : const Color(0xfff4e6df),
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Text(
        initials,
        style: context.textTheme.labelSmall?.copyWith(
          color: agent ? const Color(0xff63826c) : const Color(0xff98715e),
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

String _title(FeedItem item, String author) {
  if (item.category == 'needs_action') return 'Your review is needed';
  if (isThreadReply(item.tags) || item.kind == 9) {
    return '$author replied to you';
  }
  if (item.kind == 43004) return 'Research completed';
  return item.headline;
}

String _subtitle(FeedItem item, String author) {
  final content = item.displayContent.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (item.category == 'needs_action') {
    return '$author · $content';
  }
  if (item.category == 'agent_activity') {
    final context = item.content.trim().isEmpty ? item.channelName : content;
    return '$author · ${context.isEmpty ? item.displayContent : context}';
  }
  return content;
}

String _initial(String pubkey) =>
    pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?';

String? _firstName(String? name) {
  final normalized = name?.trim();
  if (normalized == null || normalized.isEmpty) return null;
  return normalized.split(RegExp(r'\s+')).first;
}
