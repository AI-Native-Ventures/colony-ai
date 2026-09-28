import 'package:flutter/material.dart';

import '../../shared/animated_avatar.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/profile/user_profile.dart';
import 'conversation_styles.dart';

enum ConversationAvatarTint { lilac, coral, sage }

class ConversationAvatar extends StatelessWidget {
  final UserProfile? profile;
  final String pubkey;
  final double size;
  final ConversationAvatarTint tint;
  final bool isOnline;

  const ConversationAvatar({
    super.key,
    required this.profile,
    required this.pubkey,
    this.size = conversationAvatarSize,
    this.tint = ConversationAvatarTint.lilac,
    this.isOnline = false,
  });

  @override
  Widget build(BuildContext context) {
    final avatarUrl = profile?.avatarUrl;
    final animatedAvatar = parseAnimatedAvatarUrl(avatarUrl);
    final initials = conversationInitials(
      profile?.displayName ?? profile?.label ?? profile?.initial,
      fallback: pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?',
    );
    final isAgent =
        profile?.isAgent == true || tint == ConversationAvatarTint.sage;
    return KeyedSubtree(
      key: ValueKey('message-avatar-rounded-square-$pubkey'),
      child: IdentityAvatar(
        key: const ValueKey('message-avatar-surface'),
        initials: initials,
        kind: isAgent ? IdentityKind.agent : IdentityKind.person,
        tone: switch (tint) {
          ConversationAvatarTint.sage => IdentityAvatarTone.sage,
          ConversationAvatarTint.coral ||
          ConversationAvatarTint.lilac => IdentityAvatarTone.peach,
        },
        imageUrl: animatedAvatar?.posterUrl ?? avatarUrl,
        size: size,
        isOnline: isOnline,
        excludeSemantics: true,
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
