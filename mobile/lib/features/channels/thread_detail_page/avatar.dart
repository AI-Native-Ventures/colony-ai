part of '../thread_detail_page.dart';

class _Avatar extends StatelessWidget {
  final UserProfile? profile;
  final String pubkey;
  final bool isAgent;

  const _Avatar({
    required this.profile,
    required this.pubkey,
    required this.isAgent,
  });

  @override
  Widget build(BuildContext context) {
    return ConversationAvatar(
      profile: profile,
      pubkey: pubkey,
      tint: conversationAvatarTint(profile: profile, isAgent: isAgent),
    );
  }
}
