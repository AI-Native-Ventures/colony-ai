import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/bee_refresh_indicator.dart';
import 'forum_models.dart';
import 'forum_post_card.dart';
import 'forum_provider.dart';
import 'forum_presentation.dart';
import 'forum_thread_page.dart';

/// Main forum view for a channel's recent posts.
class ForumPostsView extends HookConsumerWidget {
  final String channelId;
  final String channelName;
  final String? currentPubkey;
  final bool isMember;
  final bool isArchived;
  final ForumPresentationFactories? presentation;

  const ForumPostsView({
    super.key,
    required this.channelId,
    required this.channelName,
    required this.currentPubkey,
    required this.isMember,
    required this.isArchived,
    this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final postsAsync = ref.watch(forumPostsProvider(channelId));
    // A queued attachment can finish after this view is popped. Capture the
    // app-level provider container instead of retaining the route's WidgetRef.
    final providerContainer = ProviderScope.containerOf(context, listen: false);
    final forumDelivery = ForumEventDelivery.capture(providerContainer);

    // Periodic refresh (every 15s, matching desktop).
    useEffect(() {
      final timer = Stream.periodic(const Duration(seconds: 15)).listen((_) {
        ref.invalidate(forumPostsProvider(channelId));
      });
      return timer.cancel;
    }, [channelId]);

    return Scaffold(
      // Transparent so the parent Scaffold's background shows through.
      backgroundColor: Colors.transparent,
      body: postsAsync.when(
        loading: () => Padding(
          padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
          child: const Center(
            child: BuzzLoadingIndicator(
              size: 44,
              semanticLabel: 'Loading posts',
            ),
          ),
        ),
        error: (e, _) => Padding(
          padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
          child: Center(
            child: Text(
              'Failed to load posts',
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.error,
              ),
            ),
          ),
        ),
        data: (response) {
          final posts = response.posts;
          if (posts.isEmpty) {
            return _EmptyState(isMember: isMember, isArchived: isArchived);
          }
          final entries = <({String? heading, ForumPost? post})>[];
          for (final group in _forumPostGroups(context, posts)) {
            entries.add((heading: group.title, post: null));
            for (final post in group.posts) {
              entries.add((heading: null, post: post));
            }
          }
          return BeeRefreshIndicator(
            onRefresh: () async {
              ref.invalidate(forumPostsProvider(channelId));
              await ref.read(forumPostsProvider(channelId).future);
            },
            child: ListView.separated(
              padding: EdgeInsets.only(
                top:
                    frostedAppBarHeight(
                      context,
                      titleContentHeight: MobileLayoutTokens.appBarHeight,
                    ) -
                    Grid.half,
                left: Grid.xs,
                right: Grid.xs,
                bottom: MobileLayoutTokens.scrollBottomPadding,
              ),
              itemCount: entries.length,
              separatorBuilder: (_, index) => SizedBox(
                height: entries[index].heading == null ? Grid.xxs : Grid.half,
              ),
              itemBuilder: (context, index) {
                final entry = entries[index];
                if (entry.heading case final heading?) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Grid.half,
                      vertical: Grid.half,
                    ),
                    child: Text(
                      heading,
                      style: context.mobileTypography.identityName.copyWith(
                        color: context.mobileTokens.ink,
                      ),
                    ),
                  );
                }
                final post = entry.post!;
                return ForumPostCard(
                  post: post,
                  currentPubkey: currentPubkey,
                  presentation: presentation,
                  onTap: () => _openThread(context, post),
                  onDelete: (eventId) async {
                    await forumDelivery.deleteEvent(
                      channelId: channelId,
                      eventId: eventId,
                    );
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }

  void _openThread(BuildContext context, ForumPost post) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ForumThreadPage(
          channelId: channelId,
          channelName: channelName,
          postEventId: post.eventId,
          currentPubkey: currentPubkey,
          isMember: isMember,
          isArchived: isArchived,
          presentation: presentation,
        ),
      ),
    );
  }
}

List<({String title, List<ForumPost> posts})> _forumPostGroups(
  BuildContext context,
  List<ForumPost> posts,
) {
  DateTime weekStart(DateTime date) => DateTime(
    date.year,
    date.month,
    date.day - date.weekday + DateTime.monday,
  );

  DateTime activityDate(ForumPost post) => DateTime.fromMillisecondsSinceEpoch(
    (post.threadSummary?.lastReplyAt ?? post.createdAt) * 1000,
    isUtc: true,
  ).toLocal();

  final currentWeek = weekStart(DateTime.now());
  final previousWeek = currentWeek.subtract(const Duration(days: 7));
  final grouped = <DateTime, List<ForumPost>>{};
  for (final post in posts) {
    grouped.putIfAbsent(weekStart(activityDate(post)), () => []).add(post);
  }
  return [
    for (final entry in grouped.entries)
      (
        title: entry.key == currentWeek
            ? 'This week'
            : entry.key == previousWeek
            ? 'Last week'
            : MaterialLocalizations.of(context).formatMonthYear(entry.key),
        posts: entry.value,
      ),
  ];
}

class _EmptyState extends StatelessWidget {
  final bool isMember;
  final bool isArchived;

  const _EmptyState({required this.isMember, required this.isArchived});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Grid.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              LucideIcons.messageSquareText,
              size: Grid.xl,
              color: context.colors.onSurfaceVariant,
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              'No posts yet',
              style: context.textTheme.bodyLarge?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: Grid.half),
            Text(
              isArchived
                  ? 'This forum is archived.'
                  : isMember
                  ? 'Start a discussion by creating the first post.'
                  : 'Join this forum to create posts.',
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
