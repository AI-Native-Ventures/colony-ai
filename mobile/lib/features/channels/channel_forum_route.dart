import '../../shared/navigation/mobile_route.dart';

/// Data required to render a forum channel without coupling channels to forum.
class ChannelForumEntryArguments {
  /// Creates the channel details needed to open its forum timeline.
  const ChannelForumEntryArguments({
    required this.channelId,
    required this.channelName,
    required this.currentPubkey,
    required this.isMember,
    required this.isArchived,
  });

  /// Relay channel id used to load the forum posts.
  final String channelId;

  /// Visible channel title for forum thread context.
  final String channelName;

  /// Signed-in identity used for ownership and mention treatment.
  final String? currentPubkey;

  /// Whether the signed-in user can post and reply.
  final bool isMember;

  /// Whether the channel is archived and read-only.
  final bool isArchived;
}

/// Typed app-composition entry used when a channel route contains a forum.
abstract final class ChannelForumRoutes {
  /// Opens the forum timeline for one channel.
  static const posts = MobileRoute<ChannelForumEntryArguments>(
    'channels/forum/posts',
  );
}
