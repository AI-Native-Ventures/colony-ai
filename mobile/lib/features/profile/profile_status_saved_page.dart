import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/emoji/emoji_glyph.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_provider.dart';
import 'user_status_provider.dart';

/// Shows the saved status on the profile before returning to settings.
class ProfileStatusSavedPage extends ConsumerWidget {
  const ProfileStatusSavedPage({
    this.emojiBuilder,
    this.avatarBuilder,
    super.key,
  });

  @visibleForTesting
  final EmojiGlyphBuilder? emojiBuilder;

  @visibleForTesting
  final Widget Function()? avatarBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).asData?.value;
    final status = ref.watch(userStatusProvider).asData?.value;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final profileName = profile?.displayName?.trim() ?? '';
    final name = profileName.isEmpty ? 'Your profile' : profileName;
    final detail = status == null || status.isEmpty
        ? 'Your team sees your usual availability.'
        : _clearStatusDescription(status.expirationDateTime);
    final colors = context.colors;

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Your profile'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.gutter,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          Text(
            name,
            style: context.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.eighteen),
          Text(
            community?.name ?? 'Your team',
            style: context.textTheme.bodyMedium,
          ),
          const SizedBox(height: Grid.xs),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Column(
              children: [
                avatarBuilder?.call() ??
                    AvatarImage(
                      imageUrl: profile?.avatarUrl,
                      radius: 54,
                      backgroundColor: colors.secondaryContainer,
                      emojiBuilder: emojiBuilder,
                      fallback: Text(_initials(name)),
                    ),
                const SizedBox(height: 14),
                if (status == null || status.isEmpty)
                  Text(
                    'No status set',
                    textAlign: TextAlign.center,
                    style: context.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (status.emoji.isNotEmpty) ...[
                        EmojiGlyph(
                          emoji: status.emoji,
                          fontSize: 18,
                          builder: emojiBuilder,
                        ),
                        const SizedBox(width: Grid.xxs),
                      ],
                      Flexible(
                        child: Text(
                          status.text,
                          textAlign: TextAlign.center,
                          style: context.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: Grid.sm),
                Text(
                  detail,
                  textAlign: TextAlign.center,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: Grid.gutter),
          SizedBox(
            height: 44,
            child: FilledButton.tonal(
              style: FilledButton.styleFrom(
                backgroundColor: context.mobileTokens.soft,
                foregroundColor: context.mobileTokens.ink,
              ),
              onPressed: () =>
                  MobileNavigation.push<NoMobileRouteArguments, Object?>(
                    context,
                    MobileRoutes.profileStatus,
                    const NoMobileRouteArguments(),
                  ),
              child: const Text('Edit status'),
            ),
          ),
        ],
      ),
    );
  }
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final initials = parts.take(2).map((part) => part.characters.first).join();
  return initials.isEmpty ? '?' : initials.toUpperCase();
}

String _clearStatusDescription(DateTime? expiresAt) {
  if (expiresAt == null) return 'Does not clear automatically';
  final remaining = expiresAt.difference(DateTime.now());
  if (remaining.inDays >= 7) return 'Clears after 1 week';
  if (remaining.inDays >= 1) return 'Clears after 1 day';
  if (remaining.inHours >= 8) return 'Clears after 8 hours';
  if (remaining.inHours >= 1) return 'Clears after 1 hour';
  return 'Clears soon';
}
