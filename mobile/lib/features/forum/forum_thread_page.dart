import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/profile/user_profile.dart';
import 'forum_models.dart';
import 'forum_post_content.dart';
import 'forum_presentation.dart';
import 'forum_provider.dart';

final _forumClockTimeFormat = DateFormat('HH:mm');

/// Full-screen page showing a forum post and its replies.
class ForumThreadPage extends HookConsumerWidget {
  final String channelId;
  final String channelName;
  final String postEventId;
  final String? currentPubkey;
  final bool isMember;
  final bool isArchived;
  final ForumPresentationFactories? presentation;

  const ForumThreadPage({
    super.key,
    required this.channelId,
    this.channelName = '',
    required this.postEventId,
    required this.currentPubkey,
    required this.isMember,
    required this.isArchived,
    this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadAsync = ref.watch(
      forumThreadProvider((channelId: channelId, eventId: postEventId)),
    );
    // Periodic refresh (every 10s, matching desktop).
    useEffect(() {
      final timer = Stream.periodic(const Duration(seconds: 10)).listen((_) {
        ref.invalidate(
          forumThreadProvider((channelId: channelId, eventId: postEventId)),
        );
      });
      return timer.cancel;
    }, [channelId, postEventId]);

    return FrostedScaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: FrostedAppBar(
        titleContentHeight: MobileLayoutTokens.appBarHeight,
        title: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Team note',
              style: context.mobileTypography.companyHubTitle.copyWith(
                color: context.mobileTokens.ink,
              ),
            ),
            Text(
              channelName.isEmpty ? 'Forum' : channelName,
              style: context.mobileTypography.companyHubSubtitle.copyWith(
                color: context.mobileTokens.muted,
              ),
            ),
          ],
        ),
        horizontalInset: Grid.gutter,
        iconColor: context.mobileTokens.ink,
        frostedSurfaceOpacity: 0,
        frostedBlurSigma: 0,
        bottomDividerOpacity: 1,
        actions: [
          if (presentation?.openQuickActions case final openQuickActions?)
            IconButton(
              onPressed: () => openQuickActions(ref),
              tooltip: 'Quick actions',
              icon: const Icon(LucideIcons.plus),
            ),
        ],
      ),
      body: threadAsync.when(
        loading: () => Padding(
          padding: EdgeInsets.only(
            top: frostedAppBarHeight(
              context,
              titleContentHeight: MobileLayoutTokens.appBarHeight,
            ),
          ),
          child: const Center(
            child: BuzzLoadingIndicator(
              size: 44,
              semanticLabel: 'Loading thread',
            ),
          ),
        ),
        error: (e, _) => Padding(
          padding: EdgeInsets.only(
            top: frostedAppBarHeight(
              context,
              titleContentHeight: MobileLayoutTokens.appBarHeight,
            ),
          ),
          child: Center(
            child: Text(
              'Failed to load thread',
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.error,
              ),
            ),
          ),
        ),
        data: (thread) => _ThreadContent(
          thread: thread,
          channelId: channelId,
          channelName: channelName,
          currentPubkey: currentPubkey,
          isMember: isMember,
          isArchived: isArchived,
          presentation: presentation,
          onPostActions: () => _showPostActions(context, ref, thread),
        ),
      ),
    );
  }

  void _showPostActions(
    BuildContext context,
    WidgetRef ref,
    ForumThreadResponse thread,
  ) {
    showBuzzModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: IconTheme.merge(
          data: const IconThemeData(size: 22),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              0,
              Grid.gutter,
              Grid.xs,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(LucideIcons.copy),
                  title: const Text('Copy text'),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    Clipboard.setData(ClipboardData(text: thread.post.content));
                  },
                ),
                ListTile(
                  leading: Icon(
                    LucideIcons.trash2,
                    color: sheetContext.colors.error,
                  ),
                  title: Text(
                    'Delete post',
                    style: TextStyle(color: sheetContext.colors.error),
                  ),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    _confirmDeletePost(context, ref, thread.post.eventId);
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _confirmDeletePost(BuildContext context, WidgetRef ref, String eventId) {
    showBuzzDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete post'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await deleteForumEvent(
                ref,
                channelId: channelId,
                eventId: eventId,
              );
              if (context.mounted) {
                Navigator.of(context).pop();
              }
            },
            style: FilledButton.styleFrom(
              backgroundColor: dialogContext.colors.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class _ThreadContent extends HookConsumerWidget {
  final ForumThreadResponse thread;
  final String channelId;
  final String channelName;
  final String? currentPubkey;
  final bool isMember;
  final bool isArchived;
  final ForumPresentationFactories? presentation;
  final VoidCallback onPostActions;

  const _ThreadContent({
    required this.thread,
    required this.channelId,
    required this.channelName,
    required this.currentPubkey,
    required this.isMember,
    required this.isArchived,
    required this.presentation,
    required this.onPostActions,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Background media delivery may outlive this route's WidgetRef.
    final providerContainer = ProviderScope.containerOf(context, listen: false);
    final forumDelivery = ForumEventDelivery.capture(providerContainer);
    final presentationFactories = presentation;
    final post = thread.post;
    final replies = thread.replies;

    // Preload profiles for all participants and tagged mentions.
    final allPubkeys = useMemoized(() {
      final pks = <String>{
        post.pubkey.toLowerCase(),
        ...post.mentionPubkeys.map((pubkey) => pubkey.toLowerCase()),
      };
      for (final reply in replies) {
        pks
          ..add(reply.pubkey.toLowerCase())
          ..addAll(reply.mentionPubkeys.map((pubkey) => pubkey.toLowerCase()));
      }
      return pks.toList()..sort();
    }, [post, replies]);
    final allPubkeysKey = allPubkeys.join('\u0000');

    useEffect(() {
      if (allPubkeys.isNotEmpty) {
        ref.read(userCacheProvider.notifier).preload(allPubkeys);
      }
      return null;
    }, [allPubkeysKey]);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.only(
              top:
                  frostedAppBarHeight(
                    context,
                    titleContentHeight: MobileLayoutTokens.appBarHeight,
                  ) -
                  Grid.xs,
              bottom: Grid.xs,
            ),
            children: [
              if (currentPubkey != null &&
                  post.pubkey.toLowerCase() == currentPubkey!.toLowerCase())
                Semantics(
                  customSemanticsActions: {
                    CustomSemanticsAction(label: 'Post actions'): onPostActions,
                  },
                  child: GestureDetector(
                    onLongPress: onPostActions,
                    child: _OriginalPost(
                      post: post,
                      channelId: channelId,
                      presentation: presentation,
                    ),
                  ),
                )
              else
                _OriginalPost(
                  post: post,
                  channelId: channelId,
                  presentation: presentation,
                ),

              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Grid.gutter,
                  vertical: Grid.xs,
                ),
                child: Row(
                  children: [
                    Text(
                      'Discussion',
                      style: context.mobileTypography.identityName.copyWith(
                        color: context.mobileTokens.ink,
                      ),
                    ),
                  ],
                ),
              ),

              // Reply list
              if (replies.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(Grid.sm),
                  child: Text(
                    'No replies yet',
                    style: context.mobileTypography.body.copyWith(
                      color: context.mobileTokens.muted,
                    ),
                    textAlign: TextAlign.center,
                  ),
                )
              else
                for (final reply in replies)
                  _ReplyRow(
                    reply: reply,
                    currentPubkey: currentPubkey,
                    channelId: channelId,
                    rootEventId: post.eventId,
                    presentation: presentation,
                  ),
            ],
          ),
        ),

        // Reply composer
        if (isMember && !isArchived && presentationFactories != null)
          presentationFactories.composeBarBuilder(
            channelId: channelId,
            channelName: channelName,
            hintText: 'Reply to this post\u2026',
            onSend:
                (
                  content,
                  mentionPubkeys, {
                  mediaTags = const <List<String>>[],
                }) => forumDelivery.createReply(
                  channelId: channelId,
                  parentEventId: post.eventId,
                  content: content,
                  mentionPubkeys: mentionPubkeys,
                  mediaTags: mediaTags,
                ),
          ),
      ],
    );
  }
}

class _OriginalPost extends ConsumerWidget {
  final ForumPost post;
  final String channelId;
  final ForumPresentationFactories? presentation;

  const _OriginalPost({
    required this.post,
    required this.channelId,
    required this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contentParts = parseForumPostContent(post.content);
    final pk = post.pubkey.toLowerCase();
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);
    final displayName = profile?.label ?? shortPubkey(post.pubkey);

    final userCache = ref.watch(userCacheProvider);
    final agentMentionPubkeys = agentPubkeysWithProfileOwners(
      knownAgentPubkeys: ref.watch(agentMentionPubkeysProvider(channelId)),
      profileOwnedAgentPubkeys: [
        for (final profile in userCache.values)
          if (profile.ownerPubkey != null) profile.pubkey,
      ],
    );
    final mentionNames = mentionNamesWithDirectoryLabels(
      mentionPubkeys: post.mentionPubkeys,
      profileMentionNames: _buildMentionNames(post.mentionPubkeys, userCache),
      directoryDisplayNames: ref.watch(agentDirectoryDisplayNamesProvider),
      agentMentionPubkeys: agentMentionPubkeys,
    );
    final isAgent =
        profile?.isAgent == true || agentMentionPubkeys.contains(pk);
    final contentSpec = ForumMessageContentSpec(
      content: contentParts.body,
      mentionNames: mentionNames,
      agentMentionPubkeys: agentMentionPubkeys,
      tags: post.tags,
      baseStyle: context.mobileTypography.body.copyWith(
        color: context.mobileTokens.ink,
      ),
      onMentionTap: presentation == null
          ? null
          : (pubkey) => presentation!.openProfile(context, pubkey),
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        MobileLayoutTokens.contentGutter,
        Grid.half,
        MobileLayoutTokens.contentGutter,
        Grid.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              GestureDetector(
                onTap: presentation == null
                    ? null
                    : () => presentation!.openProfile(context, post.pubkey),
                child: _Avatar(
                  key: ValueKey('forum-original-avatar-${post.eventId}'),
                  profile: profile,
                  pubkey: post.pubkey,
                  size: Grid.lg,
                  isAgent: isAgent,
                ),
              ),
              const SizedBox(width: Grid.xxs),
              Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: presentation == null
                            ? null
                            : () => presentation!.openProfile(
                                context,
                                post.pubkey,
                              ),
                        child: Text(
                          displayName,
                          maxLines: 1,
                          style: context.mobileTypography.identityName.copyWith(
                            color: context.mobileTokens.ink,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                    if (isAgent) ...[
                      const SizedBox(width: Grid.half),
                      const IdentityAgentBadge(),
                    ],
                    const SizedBox(width: Grid.xxs),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: Grid.xxl),
                      child: Text(
                        _formatNoteDateTime(post.createdAt),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.mobileTypography.identityStatus.copyWith(
                          color: context.mobileTokens.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (contentParts.title.isNotEmpty) ...[
            const SizedBox(height: Grid.xs),
            Text(
              contentParts.title,
              style: context.textTheme.headlineSmall?.copyWith(
                color: context.mobileTokens.ink,
              ),
            ),
          ],
          if (contentParts.body.isNotEmpty) ...[
            const SizedBox(height: Grid.xxs),
            presentation?.messageContentBuilder(context, contentSpec) ??
                Text(contentParts.body, style: contentSpec.baseStyle),
          ],
        ],
      ),
    );
  }
}

class _ReplyRow extends ConsumerWidget {
  final ThreadReply reply;
  final String? currentPubkey;
  final String channelId;
  final String rootEventId;
  final ForumPresentationFactories? presentation;

  const _ReplyRow({
    required this.reply,
    required this.currentPubkey,
    required this.channelId,
    required this.rootEventId,
    required this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pk = reply.pubkey.toLowerCase();
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);
    final displayName = profile?.label ?? shortPubkey(reply.pubkey);

    final userCache = ref.watch(userCacheProvider);
    final agentMentionPubkeys = agentPubkeysWithProfileOwners(
      knownAgentPubkeys: ref.watch(agentMentionPubkeysProvider(channelId)),
      profileOwnedAgentPubkeys: [
        for (final profile in userCache.values)
          if (profile.ownerPubkey != null) profile.pubkey,
      ],
    );
    final mentionNames = mentionNamesWithDirectoryLabels(
      mentionPubkeys: reply.mentionPubkeys,
      profileMentionNames: _buildMentionNames(reply.mentionPubkeys, userCache),
      directoryDisplayNames: ref.watch(agentDirectoryDisplayNamesProvider),
      agentMentionPubkeys: agentMentionPubkeys,
    );
    final isAgent =
        profile?.isAgent == true || agentMentionPubkeys.contains(pk);
    final contentSpec = ForumMessageContentSpec(
      content: reply.content,
      mentionNames: mentionNames,
      agentMentionPubkeys: agentMentionPubkeys,
      tags: reply.tags,
      baseStyle: context.mobileTypography.body.copyWith(
        color: context.mobileTokens.ink,
      ),
      onMentionTap: presentation == null
          ? null
          : (pubkey) => presentation!.openProfile(context, pubkey),
    );

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Grid.gutter,
        vertical: Grid.xxs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              GestureDetector(
                onTap: presentation == null
                    ? null
                    : () => presentation!.openProfile(context, reply.pubkey),
                child: _Avatar(
                  key: ValueKey('forum-reply-avatar-${reply.eventId}'),
                  profile: profile,
                  pubkey: reply.pubkey,
                  size: Grid.lg,
                  isAgent: isAgent,
                ),
              ),
              const SizedBox(width: Grid.xxs),
              Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: presentation == null
                            ? null
                            : () => presentation!.openProfile(
                                context,
                                reply.pubkey,
                              ),
                        child: Text(
                          displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.identityName.copyWith(
                            color: context.mobileTokens.ink,
                          ),
                        ),
                      ),
                    ),
                    if (isAgent) ...[
                      const SizedBox(width: Grid.half),
                      const IdentityAgentBadge(),
                    ],
                    const SizedBox(width: Grid.xxs),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: Grid.xxl),
                      child: Text(
                        _forumClockTimeFormat.format(
                          DateTime.fromMillisecondsSinceEpoch(
                            reply.createdAt * 1000,
                            isUtc: true,
                          ).toLocal(),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.mobileTypography.identityStatus.copyWith(
                          color: context.mobileTokens.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 28,
                height: 28,
                child: IconButton(
                  onPressed: () => _showActions(context, ref),
                  icon: Icon(
                    LucideIcons.ellipsis,
                    size: 16,
                    color: context.mobileTokens.muted,
                  ),
                  padding: EdgeInsets.zero,
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ],
          ),
          Padding(
            padding: EdgeInsets.only(left: Grid.lg + Grid.xxs, top: Grid.half),
            child:
                presentation?.messageContentBuilder(context, contentSpec) ??
                Text(reply.content, style: contentSpec.baseStyle),
          ),
        ],
      ),
    );
  }

  void _showActions(BuildContext context, WidgetRef ref) {
    final isOwn =
        currentPubkey != null &&
        reply.pubkey.toLowerCase() == currentPubkey!.toLowerCase();

    showBuzzModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: IconTheme.merge(
          data: const IconThemeData(size: 22),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              0,
              Grid.gutter,
              Grid.xs,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(LucideIcons.copy),
                  title: const Text('Copy text'),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    Clipboard.setData(ClipboardData(text: reply.content));
                  },
                ),
                if (isOwn)
                  ListTile(
                    leading: Icon(
                      LucideIcons.trash2,
                      color: sheetContext.colors.error,
                    ),
                    title: Text(
                      'Delete reply',
                      style: TextStyle(color: sheetContext.colors.error),
                    ),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _confirmDelete(context, ref);
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context, WidgetRef ref) {
    showBuzzDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete reply'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await deleteForumEvent(
                ref,
                channelId: channelId,
                eventId: reply.eventId,
                rootEventId: rootEventId,
              );
            },
            style: FilledButton.styleFrom(
              backgroundColor: dialogContext.colors.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

String _formatNoteDateTime(int unixSeconds) {
  final date = DateTime.fromMillisecondsSinceEpoch(
    unixSeconds * 1000,
    isUtc: true,
  ).toLocal();
  final now = DateTime.now();
  final isToday =
      date.year == now.year && date.month == now.month && date.day == now.day;
  if (isToday) return 'Today, ${_forumClockTimeFormat.format(date)}';
  return formatRelativeTime(unixSeconds);
}

class _Avatar extends StatelessWidget {
  final UserProfile? profile;
  final String pubkey;
  final double size;
  final bool isAgent;

  const _Avatar({
    super.key,
    required this.profile,
    required this.pubkey,
    required this.size,
    required this.isAgent,
  });

  @override
  Widget build(BuildContext context) {
    return IdentityAvatar(
      initials:
          profile?.initials ??
          (pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?'),
      kind: isAgent ? IdentityKind.agent : IdentityKind.person,
      imageUrl: profile?.avatarUrl,
      size: size,
      excludeSemantics: true,
    );
  }
}

Map<String, String> _buildMentionNames(
  List<String> mentionPubkeys,
  Map<String, UserProfile> userCache,
) {
  final names = <String, String>{};
  for (final pk in mentionPubkeys) {
    final p = userCache[pk.toLowerCase()];
    if (p?.displayName != null) {
      names[pk.toLowerCase()] = p!.displayName!;
    }
  }
  return names;
}
