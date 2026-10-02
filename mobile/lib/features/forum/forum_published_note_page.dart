import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'forum_presentation.dart';

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
    final titleStyle = context.mobileTypography.companySection.copyWith(
      color: context.mobileTokens.ink,
    );
    final bodyStyle = context.mobileTypography.body.copyWith(
      color: context.mobileTokens.ink,
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
          if (index > 0) const SizedBox(height: Grid.sm),
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
      backgroundColor: context.mobileTokens.canvas,
      appBar: FrostedAppBar(
        leading: IconButton(
          onPressed: backToForum,
          tooltip: 'Back',
          icon: const Icon(LucideIcons.chevronLeft, size: 20),
        ),
        titleContentHeight: titleContentHeight,
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
              channelName,
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
          if (presentation.openQuickActions case final openQuickActions?)
            IconButton(
              onPressed: () => openQuickActions(ref),
              tooltip: 'Quick actions',
              icon: const Icon(LucideIcons.plus),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                MobileLayoutTokens.contentGutter,
                frostedAppBarHeight(
                      context,
                      titleContentHeight: titleContentHeight,
                    ) +
                    Grid.xs,
                MobileLayoutTokens.contentGutter,
                MobileLayoutTokens.scrollBottomPadding,
              ),
              children: [
                Row(
                  children: [
                    IdentityAvatar(
                      initials: _initials(authorName),
                      kind: IdentityKind.person,
                      size: MobileLayoutTokens.companyHeaderAvatarSize,
                      excludeSemantics: true,
                    ),
                    const SizedBox(width: Grid.xxs),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            authorName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.mobileTypography.identityName
                                .copyWith(color: context.mobileTokens.ink),
                          ),
                          Text(
                            'Just now',
                            style: context.mobileTypography.identityStatus
                                .copyWith(color: context.mobileTokens.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Grid.lg),
                Text(title, style: titleStyle),
                const SizedBox(height: Grid.xs),
                bodyContent,
                const SizedBox(height: Grid.xl),
                Divider(color: context.mobileTokens.line),
                const SizedBox(height: Grid.xs),
                Text(
                  'Discussion',
                  style: context.mobileTypography.identityName.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  'No replies yet',
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.muted,
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
                Grid.xs,
                Grid.xs,
                Grid.xs,
                MediaQuery.viewPaddingOf(context).bottom + Grid.half,
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  onPressed: backToForum,
                  style: FilledButton.styleFrom(
                    backgroundColor: context.mobileTokens.action,
                    foregroundColor: context.mobileTokens.onAction,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(Radii.button),
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
