import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/identity/identity_components.dart';
import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/profile/user_profile.dart';
import 'forum_models.dart';
import 'forum_post_content.dart';
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
    final isAgent =
        profile?.isAgent == true || agentMentionPubkeys.contains(pk);
    final summary = post.threadSummary;
    final contentParts = parseForumPostContent(post.content);
    final contentSpec = ForumMessageContentSpec(
      content: contentParts.body,
      mentionNames: mentionNames,
      agentMentionPubkeys: agentMentionPubkeys,
      tags: post.tags,
      maxLines: 3,
      baseStyle: context.mobileTypography.metadata.copyWith(
        color: context.mobileTokens.muted,
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
          padding: const EdgeInsets.all(Grid.xs),
          decoration: BoxDecoration(
            color: context.mobileTokens.paper,
            borderRadius: BorderRadius.circular(Radii.companyCard),
            border: Border.all(color: context.mobileTokens.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  IdentityAvatar(
                    initials:
                        profile?.initials ??
                        (post.pubkey.isNotEmpty
                            ? post.pubkey[0].toUpperCase()
                            : '?'),
                    kind:
                        profile?.isAgent == true ||
                            agentMentionPubkeys.contains(pk)
                        ? IdentityKind.agent
                        : IdentityKind.person,
                    imageUrl: profile?.avatarUrl,
                    size: Grid.xs + Grid.twelve,
                    excludeSemantics: true,
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: Text(
                      displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.identityName.copyWith(
                        color: context.mobileTokens.ink,
                      ),
                    ),
                  ),
                  if (isAgent) ...[
                    const SizedBox(width: Grid.half),
                    const IdentityAgentBadge(),
                  ],
                  Text(
                    formatRelativeTime(post.createdAt),
                    style: context.mobileTypography.identityStatus.copyWith(
                      color: context.mobileTokens.muted,
                    ),
                  ),
                ],
              ),
              if (contentParts.title.isNotEmpty) ...[
                const SizedBox(height: Grid.xxs),
                Text(
                  contentParts.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.conversation.copyWith(
                    color: context.mobileTokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              if (contentParts.body.isNotEmpty) ...[
                const SizedBox(height: Grid.half),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: Grid.xxl),
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
              const SizedBox(height: Grid.xxs),
              LayoutBuilder(
                builder: (context, constraints) {
                  final replySummary = Row(
                    children: [
                      Flexible(
                        child: Text(
                          '${summary?.replyCount ?? 0} ${summary?.replyCount == 1 ? 'reply' : 'replies'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.metadata.copyWith(
                            color: context.mobileTokens.muted,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  );
                  final openNote = Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          'Open note',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.identityName.copyWith(
                            color: context.appColors.plum,
                          ),
                        ),
                      ),
                      const SizedBox(width: Grid.half),
                      Icon(
                        LucideIcons.arrowUpRight,
                        size: Grid.xs,
                        color: context.appColors.plum,
                      ),
                    ],
                  );
                  if (constraints.maxWidth < Grid.xxl * 4) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        replySummary,
                        Align(
                          alignment: Alignment.centerRight,
                          child: openNote,
                        ),
                      ],
                    );
                  }
                  return Row(
                    children: [
                      Expanded(child: replySummary),
                      const SizedBox(width: Grid.xs),
                      openNote,
                    ],
                  );
                },
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
