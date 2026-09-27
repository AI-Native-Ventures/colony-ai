import 'package:flutter/material.dart';

import '../../shared/animated_avatar.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import 'conversation_styles.dart';

enum ConversationAvatarTint { lilac, coral, sage }

class ConversationAvatar extends StatelessWidget {
  final UserProfile? profile;
  final String pubkey;
  final double size;
  final double radius;
  final ConversationAvatarTint tint;

  const ConversationAvatar({
    super.key,
    required this.profile,
    required this.pubkey,
    this.size = conversationAvatarSize,
    this.radius = conversationAvatarRadius,
    this.tint = ConversationAvatarTint.lilac,
  });

  @override
  Widget build(BuildContext context) {
    final avatarUrl = profile?.avatarUrl;
    final animatedAvatar = parseAnimatedAvatarUrl(avatarUrl);
    final (background, foreground) = switch (tint) {
      ConversationAvatarTint.lilac => (
        const Color(0xFFE8E2EC),
        const Color(0xFF76657D),
      ),
      ConversationAvatarTint.coral => (
        const Color(0xFFF4E6DF),
        const Color(0xFF98715E),
      ),
      ConversationAvatarTint.sage => (
        const Color(0xFFE4EDE5),
        const Color(0xFF63826C),
      ),
    };
    final initials = conversationInitials(
      profile?.displayName ?? profile?.label ?? profile?.initial,
      fallback: pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?',
    );
    final isMini = size <= conversationMiniAvatarSize;

    return ClipRRect(
      key: ValueKey('message-avatar-rounded-square-$pubkey'),
      borderRadius: BorderRadius.circular(radius),
      child: ColoredBox(
        key: const ValueKey('message-avatar-surface'),
        color: animatedAvatar == null ? background : Colors.transparent,
        child: SizedBox.square(
          dimension: size,
          child: AvatarImageContent(
            imageUrl: animatedAvatar?.posterUrl ?? avatarUrl,
            fallback: Center(
              child: Text(
                initials,
                style: context.mobileTypography.metadata.copyWith(
                  color: foreground,
                  fontSize: isMini ? 7 : 11,
                  fontWeight: FontWeight.w700,
                  height: 1,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String conversationInitials(String? name, {required String fallback}) {
  final parts = name?.trim().split(RegExp(r'\s+')) ?? const <String>[];
  final words = parts.where((part) => part.isNotEmpty).toList();
  if (words.isEmpty) return fallback;
  if (words.length == 1) return words.first.characters.first.toUpperCase();
  return '${words.first.characters.first}${words.last.characters.first}'
      .toUpperCase();
}

ConversationAvatarTint conversationAvatarTint({
  required UserProfile? profile,
  required bool isAgent,
}) {
  if (isAgent) return ConversationAvatarTint.sage;
  if (profile?.displayName?.toLowerCase() == 'maya ndlovu') {
    return ConversationAvatarTint.coral;
  }
  return ConversationAvatarTint.lilac;
}
