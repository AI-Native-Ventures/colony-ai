import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'forum_presentation.dart';

const _r19ForumPrimary = Color(0xFF45669F);

/// Shows a note immediately after the relay accepts its forum post.
class ForumPublishedNotePage extends ConsumerWidget {
  final String channelId;
  final String channelName;
  final int memberCount;
  final String title;
  final String body;
  final String postEventId;
  final List<String> mentionPubkeys;
  final List<List<String>> eventTags;
  final ForumPresentationFactories presentation;

  const ForumPublishedNotePage({
    super.key,
    required this.channelId,
    required this.channelName,
    required this.memberCount,
    required this.title,
    required this.body,
    required this.postEventId,
    required this.mentionPubkeys,
    required this.eventTags,
    required this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final displayName = presentation.currentUserName?.call(ref)?.trim();
    final authorName = displayName == null || displayName.isEmpty
        ? 'You'
        : displayName;
    final titleStyle = context.mobileTypography.body.copyWith(
      color: context.mobileTokens.ink,
      fontSize: 28,
      fontWeight: FontWeight.w700,
      height: 1.25,
      letterSpacing: -0.8,
    );
    final bodyStyle = context.mobileTypography.body.copyWith(
      color: context.mobileTokens.ink,
      fontSize: 14,
      height: 1.85,
    );
    final userCache = ref.watch(userCacheProvider);
    final agentMentionPubkeys = agentPubkeysWithProfileOwners(
      knownAgentPubkeys: ref.watch(agentMentionPubkeysProvider(channelId)),
      profileOwnedAgentPubkeys: userCache.values
          .where((profile) => profile.ownerPubkey != null)
          .map((profile) => profile.pubkey)
          .toList(),
    );
    final profileMentionNames = <String, String>{};
    for (final pubkey in mentionPubkeys) {
      final key = pubkey.toLowerCase();
      final name = userCache[key]?.displayName;
      if (name != null) profileMentionNames[key] = name;
    }
    final resolvedMentionNames = mentionNamesWithDirectoryLabels(
      mentionPubkeys: mentionPubkeys,
      profileMentionNames: profileMentionNames,
      directoryDisplayNames: ref.watch(agentDirectoryDisplayNamesProvider),
      agentMentionPubkeys: agentMentionPubkeys,
    );
    final bodySections = body.trim().split(RegExp(r'\n\s*\n'));
    final bodyContent = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var index = 0; index < bodySections.length; index++) ...[
          if (index > 0) const SizedBox(height: 22),
          presentation.messageContentBuilder(
            context,
            ForumMessageContentSpec(
              content: bodySections[index],
              mentionNames: resolvedMentionNames,
              agentMentionPubkeys: agentMentionPubkeys,
              tags: eventTags,
              baseStyle: bodyStyle,
              onMentionTap: (pubkey) =>
                  presentation.openProfile(context, pubkey),
            ),
          ),
        ],
      ],
    );
    const titleContentHeight = MobileLayoutTokens.appBarHeight;
    void backToForum() => Navigator.of(context).pop();

    return FrostedScaffold(
      key: ValueKey('forum-published-note:$channelId:$postEventId'),
      backgroundColor: context.mobileTokens.paper,
      appBar: FrostedAppBar(
        leading: IconButton(
          onPressed: backToForum,
          tooltip: 'Back',
          icon: const Icon(LucideIcons.arrowLeft, size: 20),
        ),
        titleContentHeight: titleContentHeight,
        title: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              channelName,
              style: context.mobileTypography.body.copyWith(
                color: context.mobileTokens.ink,
                fontSize: 16,
                fontWeight: FontWeight.w700,
                height: 1.25,
              ),
            ),
            Text(
              'Forum · $memberCount ${memberCount == 1 ? 'member' : 'members'}',
              style: context.mobileTypography.body.copyWith(
                color: context.mobileTokens.muted,
                fontSize: 11,
                height: 1.25,
              ),
            ),
          ],
        ),
        horizontalInset: Grid.gutter,
        iconColor: context.mobileTokens.ink,
        frostedSurfaceOpacity: 0,
        frostedBlurSigma: 0,
        bottomDividerOpacity: 1,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                20,
                frostedAppBarHeight(
                      context,
                      titleContentHeight: titleContentHeight,
                    ) +
                    12,
                20,
                20,
              ),
              children: [
                Row(
                  children: [
                    ExcludeSemantics(
                      child: Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFFE8E2EC),
                          borderRadius: BorderRadius.circular(11),
                        ),
                        child: Text(
                          _initials(authorName),
                          style: context.mobileTypography.body.copyWith(
                            color: const Color(0xFF76657D),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            authorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.mobileTypography.body.copyWith(
                              color: context.mobileTokens.ink,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            'Just now · Team note',
                            style: context.mobileTypography.body.copyWith(
                              color: context.mobileTokens.muted,
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0x1F80A890),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Posted',
                        style: context.mobileTypography.body.copyWith(
                          color: context.mobileTokens.ink,
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 30),
                Text(title, style: titleStyle),
                const SizedBox(height: 24),
                bodyContent,
                const SizedBox(height: 35),
                Divider(color: context.mobileTokens.line),
                const SizedBox(height: 24),
                Text(
                  'No replies yet',
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Your team can join the conversation here.',
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.muted,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              color: context.mobileTokens.paper,
              border: Border(top: BorderSide(color: context.mobileTokens.line)),
            ),
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                12,
                16,
                MediaQuery.viewPaddingOf(context).bottom + 42,
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  onPressed: backToForum,
                  style: FilledButton.styleFrom(
                    backgroundColor: _r19ForumPrimary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: Text('Back to $channelName'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _initials(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final selected = words.take(2).map((part) => part[0].toUpperCase()).join();
  return selected.isEmpty ? '?' : selected;
}
