part of '../thread_detail_page.dart';

class _Avatar extends StatelessWidget {
  final UserProfile? profile;
  final String pubkey;

  const _Avatar({required this.profile, required this.pubkey});

  @override
  Widget build(BuildContext context) {
    final initial =
        profile?.initial ?? (pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?');
    final avatarUrl = profile?.avatarUrl;
    final animatedAvatar = parseAnimatedAvatarUrl(avatarUrl);
    final tokens = context.mobileTokens;

    return ClipOval(
      key: const ValueKey('message-avatar-circle'),
      child: ColoredBox(
        key: const ValueKey('message-avatar-surface'),
        color: animatedAvatar == null ? tokens.soft : Colors.transparent,
        child: SizedBox.square(
          dimension: messageAvatarSize,
          child: AvatarImageContent(
            imageUrl: animatedAvatar?.posterUrl ?? avatarUrl,
            fallback: Text(
              initial,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.ink,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
