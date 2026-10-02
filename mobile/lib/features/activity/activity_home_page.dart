import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import 'activity_provider.dart';
import 'feed_item.dart';
import 'inbox_item.dart';

class ActivityHomePage extends HookConsumerWidget {
  const ActivityHomePage({
    required this.onOpenItem,
    this.onComposeUpdate,
    this.onOpenConversations,
    this.tabReselection,
    super.key,
  });

  final ValueChanged<FeedItem> onOpenItem;
  final ValueChanged<BuildContext>? onComposeUpdate;
  final VoidCallback? onOpenConversations;
  final ValueListenable<int>? tabReselection;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final community = ref.watch(activeCommunityProvider).value;
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
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          SafeArea(
            bottom: false,
            child: _ActivityHeader(
              communityName: community?.name,
              onBack: () => unawaited(Navigator.of(context).maybePop()),
              onComposeUpdate: onComposeUpdate,
            ),
          ),
          Expanded(
            child: _ActivityContent(
              items: items,
              feed: feed,
              scrollController: scrollController,
              onOpenItem: onOpenItem,
              onOpenConversations: onOpenConversations,
              onRetry: () => ref.read(activityProvider.notifier).refresh(),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityHeader extends StatelessWidget {
  const _ActivityHeader({
    required this.communityName,
    required this.onBack,
    this.onComposeUpdate,
  });

  final String? communityName;
  final VoidCallback onBack;
  final ValueChanged<BuildContext>? onComposeUpdate;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 58,
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
                  'Activity',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.titleMedium?.copyWith(
                    color: tokens.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.45,
                  ),
                ),
                Text(
                  communityName?.trim().isNotEmpty == true
                      ? communityName!.trim()
                      : 'Colony',
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
          IconButton(
            key: const ValueKey('activity-new-team-update'),
            tooltip: 'New team update',
            onPressed: onComposeUpdate == null
                ? null
                : () => onComposeUpdate!(context),
            style: IconButton.styleFrom(
              foregroundColor: tokens.ink,
              backgroundColor: tokens.paper,
              side: BorderSide(color: tokens.line),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(Radii.button),
              ),
            ),
            icon: const Icon(LucideIcons.plus),
          ),
        ],
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
    required this.onOpenConversations,
    required this.onRetry,
  });

  final List<InboxItem> items;
  final AsyncValue<HomeFeedResponse> feed;
  final ScrollController scrollController;
  final ValueChanged<FeedItem> onOpenItem;
  final VoidCallback? onOpenConversations;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      if (feed.isLoading) {
        return const Center(child: CircularProgressIndicator.adaptive());
      }
      if (feed.hasError) {
        return _ActivityUnavailableState(onRetry: onRetry);
      }
      return _ActivityEmptyState(onOpenConversations: onOpenConversations);
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

class _ActivityEmptyState extends StatelessWidget {
  const _ActivityEmptyState({required this.onOpenConversations});

  final VoidCallback? onOpenConversations;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        15,
        Grid.gutter,
        Grid.gutter,
      ),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(22, 31, 22, 35),
          decoration: BoxDecoration(
            gradient: isDark
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xff4f365d), Color(0xff563f46)],
                  )
                : context.appColors.channelInfoHeroGradient,
            borderRadius: BorderRadius.circular(27),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ALL CAUGHT UP',
                style: context.textTheme.labelSmall?.copyWith(
                  color: tokens.ink.withValues(alpha: 0.78),
                  fontSize: 9,
                  letterSpacing: 1.1,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: Grid.xxs),
              Text(
                'A quieter\nmoment.',
                style: context.mobileTypography.flowTitle.copyWith(
                  color: tokens.ink,
                  fontSize: 28,
                  height: 1.15,
                  letterSpacing: -0.8,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 51),
        Center(
          child: Container(
            width: 66,
            height: 66,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(LucideIcons.briefcaseBusiness, color: tokens.action),
          ),
        ),
        const SizedBox(height: Grid.sm),
        Text(
          'No recent activity',
          textAlign: TextAlign.center,
          style: context.textTheme.titleLarge?.copyWith(
            color: tokens.ink,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.65,
          ),
        ),
        const SizedBox(height: Grid.xxs + 7),
        Text(
          'New work and decisions will appear here when the workspace has something to show.',
          textAlign: TextAlign.center,
          style: context.textTheme.bodySmall?.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.65,
          ),
        ),
        const SizedBox(height: Grid.sm + 5),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: _FeedActionButton(
            label: 'Open conversations',
            onPressed: onOpenConversations,
          ),
        ),
      ],
    );
  }
}

class _ActivityUnavailableState extends StatelessWidget {
  const _ActivityUnavailableState({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        63,
        Grid.gutter,
        Grid.gutter,
      ),
      child: Column(
        children: [
          Container(
            width: 66,
            height: 66,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(LucideIcons.briefcaseBusiness, color: tokens.action),
          ),
          const SizedBox(height: 13),
          Text(
            'Could not load activity',
            textAlign: TextAlign.center,
            style: context.textTheme.titleLarge?.copyWith(
              color: tokens.ink,
              fontSize: 22,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.65,
            ),
          ),
          const SizedBox(height: Grid.xxs + 10),
          Text(
            'The workspace connection is unavailable. This is not an empty list. Your local drafts are safe.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall?.copyWith(
              color: tokens.muted,
              fontSize: 13,
              height: 1.65,
            ),
          ),
          const SizedBox(height: Grid.sm + 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: _FeedActionButton(
              label: 'Retry connection',
              onPressed: () => unawaited(onRetry()),
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedActionButton extends StatelessWidget {
  const _FeedActionButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: tokens.action,
          foregroundColor: tokens.onAction,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: context.textTheme.labelLarge?.copyWith(
            color: tokens.onAction,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        child: Text(label),
      ),
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
