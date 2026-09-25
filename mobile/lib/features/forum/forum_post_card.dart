import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/profile/user_profile.dart';
import 'forum_models.dart';
import 'forum_presentation.dart';

/// Card displaying a forum post preview in the posts list.
///
/// Long-press opens an action sheet (copy, delete) matching the stream
/// message pattern from channel_detail_page.dart.
class ForumPostCard extends HookConsumerWidget {
  final ForumPost post;
  final String? currentPubkey;
  final VoidCallback onTap;
  final void Function(String eventId)? onDelete;
  final ForumPresentationFactories? presentation;

  const ForumPostCard({
    super.key,
    required this.post,
    required this.currentPubkey,
    required this.onTap,
    this.onDelete,
    this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mentionPubkeys = useMemoized(
      () =>
          post.mentionPubkeys.map((pubkey) => pubkey.toLowerCase()).toSet()
            ..remove(post.pubkey.toLowerCase()),
      [post],
    );
    final mentionPubkeysKey = (mentionPubkeys.toList()..sort()).join('\u0000');

    useEffect(() {
      if (mentionPubkeys.isNotEmpty) {
        ref.read(userCacheProvider.notifier).preload(mentionPubkeys.toList());
      }
      return null;
    }, [mentionPubkeysKey]);

    final pk = post.pubkey.toLowerCase();
    final profile =
        ref.watch(userCacheProvider.select((cache) => cache[pk])) ??
        ref.read(userCacheProvider.notifier).get(pk);
    final displayName = profile?.label ?? shortPubkey(post.pubkey);
    final profileMentionNames = ref.watch(
      userCacheProvider.select(
        (cache) => _buildMentionNames(post.mentionPubkeys, cache),
      ),
    );
    final profileOwnedMentionPubkeys = ref.watch(
      userCacheProvider.select(
        (cache) =>
            (post.mentionPubkeys
                    .where(
                      (pubkey) =>
                          cache[pubkey.toLowerCase()]?.ownerPubkey != null,
                    )
                    .map((pubkey) => pubkey.toLowerCase())
                    .toList()
                  ..sort())
                .join('\u0000'),
      ),
    );
    final agentMentionPubkeys = agentPubkeysWithProfileOwners(
      knownAgentPubkeys: ref.watch(agentMentionPubkeysProvider(post.channelId)),
      profileOwnedAgentPubkeys: profileOwnedMentionPubkeys.isEmpty
          ? const <String>[]
          : profileOwnedMentionPubkeys.split('\u0000'),
    );
    final mentionNames = mentionNamesWithDirectoryLabels(
      mentionPubkeys: post.mentionPubkeys,
      profileMentionNames: profileMentionNames,
      directoryDisplayNames: ref.watch(agentDirectoryDisplayNamesProvider),
      agentMentionPubkeys: agentMentionPubkeys,
    );
    final summary = post.threadSummary;
    final contentParts = _splitForumPostContent(post.content);
    final latestParticipant = summary?.participants.firstOrNull?.toLowerCase();
    final latestProfile = latestParticipant == null
        ? null
        : ref.watch(
            userCacheProvider.select((cache) => cache[latestParticipant]),
          );
    final footerAuthor = latestProfile?.label ?? displayName;
    final footerTimestamp = summary?.lastReplyAt ?? post.createdAt;
    final footerTime = _forumDayLabel(footerTimestamp);
    final contentSpec = ForumMessageContentSpec(
      content: contentParts.body,
      mentionNames: mentionNames,
      agentMentionPubkeys: agentMentionPubkeys,
      tags: post.tags,
      maxLines: 3,
      baseStyle: messageBodyTextStyle.copyWith(
        color: context.colors.onSurfaceVariant,
        fontSize: 12,
        height: 1.5,
      ),
      onMentionTap: presentation == null
          ? null
          : (pubkey) => presentation!.openProfile(context, pubkey),
    );

    return Semantics(
      customSemanticsActions: {
        CustomSemanticsAction(label: 'Message actions'): () =>
            _showActions(context),
      },
      child: InkWell(
        onTap: onTap,
        onLongPress: () => _showActions(context),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: context.colors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: context.colors.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'TEAM NOTE',
                style: context.textTheme.labelSmall?.copyWith(
                  color: context.colors.onSurfaceVariant,
                  fontSize: 9,
                  letterSpacing: 0.35,
                ),
              ),
              if (contentParts.title.isNotEmpty) ...[
                const SizedBox(height: 7),
                Text(
                  contentParts.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.titleSmall?.copyWith(
                    color: context.colors.onSurface,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
              ],
              if (contentParts.body.isNotEmpty) ...[
                const SizedBox(height: 7),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 62),
                  child: IgnorePointer(
                    child:
                        presentation?.messageContentBuilder(
                          context,
                          contentSpec,
                        ) ??
                        Text(
                          contentParts.body,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: contentSpec.baseStyle,
                        ),
                  ),
                ),
              ],
              const SizedBox(height: 11),
              Text(
                '${summary?.replyCount ?? 0} ${summary?.replyCount == 1 ? 'reply' : 'replies'} · $footerAuthor · $footerTime',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.labelSmall?.copyWith(
                  color: context.colors.primary,
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showActions(BuildContext context) {
    final isOwn =
        currentPubkey != null &&
        post.pubkey.toLowerCase() == currentPubkey!.toLowerCase();

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
                    Clipboard.setData(ClipboardData(text: post.content));
                  },
                ),
                if (isOwn && onDelete != null)
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
                      _confirmDelete(context);
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context) {
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
            onPressed: () {
              Navigator.of(dialogContext).pop();
              onDelete?.call(post.eventId);
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

({String title, String body}) _splitForumPostContent(String content) {
  final normalized = content.trim();
  final firstLineBreak = normalized.indexOf('\n');
  if (firstLineBreak < 0) return (title: '', body: normalized);
  return (
    title: normalized.substring(0, firstLineBreak).trim(),
    body: normalized.substring(firstLineBreak + 1).trim(),
  );
}

String _forumDayLabel(int timestamp) {
  final date = DateTime.fromMillisecondsSinceEpoch(
    timestamp * 1000,
    isUtc: true,
  ).toLocal();
  final now = DateTime.now();
  if (date.year == now.year && date.month == now.month && date.day == now.day) {
    return 'Today';
  }
  final yesterday = now.subtract(const Duration(days: 1));
  if (date.year == yesterday.year &&
      date.month == yesterday.month &&
      date.day == yesterday.day) {
    return 'Yesterday';
  }
  return '${date.month}/${date.day}';
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
