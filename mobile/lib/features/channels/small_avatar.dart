import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import '../../shared/animated_avatar.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/profile/user_profile.dart';

/// 20px avatar used in thread summary rows and other compact lists.
class SmallAvatar extends StatelessWidget {
  final String pubkey;
  final Map<String, UserProfile> userCache;
  final double size;

  const SmallAvatar({
    super.key,
    required this.pubkey,
    required this.userCache,
    this.size = 20,
  });

  @override
  Widget build(BuildContext context) {
    final profile = userCache[pubkey.toLowerCase()];
    final avatarUrl = profile?.avatarUrl;
    final initial =
        profile?.initial ?? (pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?');
    final animatedAvatar = parseAnimatedAvatarUrl(avatarUrl);
    final tokens = context.mobileTokens;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.3),
        border: Border.all(color: context.colors.surface, width: 1.5),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.3),
        child: ColoredBox(
          color: animatedAvatar == null ? tokens.soft : Colors.transparent,
          child: AvatarImageContent(
            imageUrl: animatedAvatar?.posterUrl ?? avatarUrl,
            fallback: Text(
              initial,
              style: context.mobileTypography.metadata.copyWith(
                fontSize: size * 0.4,
                fontWeight: FontWeight.w700,
                color: tokens.ink,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
