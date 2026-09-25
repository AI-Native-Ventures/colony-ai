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

/// Main forum view — replaces the old _ForumPlaceholder.
///
/// Shows a list of forum posts for the channel with a FAB to open the compose
/// bar, and navigates to [ForumThreadPage] when a post is tapped.
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
    final isComposing = useState(false);
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

    final canPost = isMember && !isArchived;

    return Column(
      children: [
        Expanded(
          child: Scaffold(
            // Transparent so the parent Scaffold's background shows through.
            backgroundColor: Colors.transparent,
            floatingActionButton: canPost && !isComposing.value
                ? FloatingActionButton(
                    heroTag: 'forum-fab',
                    onPressed: () => isComposing.value = true,
                    tooltip: 'New post',
                    shape: const CircleBorder(),
                    child: const Icon(LucideIcons.plus),
                  )
                : null,
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
                  return _EmptyState(
                    isMember: isMember,
                    isArchived: isArchived,
                  );
                }
                return BeeRefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(forumPostsProvider(channelId));
                    await ref.read(forumPostsProvider(channelId).future);
                  },
                  child: ListView.separated(
                    padding: EdgeInsets.only(
                      top: frostedAppBarHeight(context) + 10,
                      left: 10,
                      right: 10,
                      bottom: Grid.xs,
                    ),
                    itemCount: posts.length + 1,
                    separatorBuilder: (_, index) =>
                        SizedBox(height: index == 0 ? 14 : 12),
                    itemBuilder: (context, index) {
                      if (index == 0) return const _RecentSortIndicator();
                      final post = posts[index - 1];
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
          ),
        ),
        if (isComposing.value) ...[
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(right: Grid.xxs),
              child: IconButton(
                onPressed: () => isComposing.value = false,
                icon: const Icon(LucideIcons.x, size: 18),
                tooltip: 'Dismiss',
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
          if (presentation case final factories?)
            factories.composeBarBuilder(
              channelId: channelId,
              hintText: 'Write your post…',
              onSend:
                  (
                    content,
                    mentionPubkeys, {
                    mediaTags = const <List<String>>[],
                  }) async {
                    await forumDelivery.createPost(
                      channelId: channelId,
                      content: content,
                      mentionPubkeys: mentionPubkeys,
                      mediaTags: mediaTags,
                    );
                    if (context.mounted) isComposing.value = false;
                  },
            ),
        ],
      ],
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

class _RecentSortIndicator extends StatelessWidget {
  const _RecentSortIndicator();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Semantics(
        label: 'Forum posts sorted by recent activity',
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: context.colors.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Text(
            'Recent',
            style: context.textTheme.labelMedium?.copyWith(
              color: context.colors.onSurface,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
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
