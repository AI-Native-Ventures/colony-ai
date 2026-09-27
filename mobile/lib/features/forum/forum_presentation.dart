import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/widgets/compose_submit_controller.dart';

/// The function shape used by a forum post or reply composer.
typedef ForumOnSend =
    Future<void> Function(
      String content,
      List<String> mentionPubkeys, {
      List<List<String>> mediaTags,
    });

/// Builds the app-composed message composer for a forum post or reply.
typedef ForumComposeBarBuilder =
    Widget Function({
      required String channelId,
      required String channelName,
      required String hintText,
      required ForumOnSend onSend,
      String? draftKeyOverride,
      bool postEditorMode,

      bool allowEmptySend,
      bool enabled,
      ComposeSubmitController? submitController,
      ValueChanged<String>? onBodyChanged,
      ValueChanged<int>? onAttachmentCountChanged,
      ValueChanged<bool>? onSubmissionChanged,
      ValueChanged<Object>? onFailure,
    });

/// Builds shared message formatting for a forum post or reply.
typedef ForumMessageContentBuilder =
    Widget Function(BuildContext context, ForumMessageContentSpec content);

/// Opens a profile from a forum author or mention.
typedef ForumProfileOpener = void Function(BuildContext context, String pubkey);

/// The message details needed by the app-composed message renderer.
@immutable
class ForumMessageContentSpec {
  /// Creates the display data for one forum message.
  const ForumMessageContentSpec({
    required this.content,
    required this.mentionNames,
    required this.agentMentionPubkeys,
    required this.tags,
    required this.baseStyle,
    this.maxLines,
    this.onMentionTap,
  });

  /// Message body text.
  final String content;

  /// Resolved labels for mentioned identities.
  final Map<String, String> mentionNames;

  /// Public keys known to represent agents in this channel.
  final Set<String> agentMentionPubkeys;

  /// Signed event tags used by message formatting.
  final List<List<String>> tags;

  /// Base text style supplied by the forum surface.
  final TextStyle baseStyle;

  /// Maximum rendered lines for compact forum previews.
  final int? maxLines;

  /// Called when a formatted mention is selected.
  final ValueChanged<String>? onMentionTap;
}

/// UI slots owned by app composition and shared across forum surfaces.
@immutable
class ForumPresentationFactories {
  /// Creates app-composed renderers for forum content and the composer.
  const ForumPresentationFactories({
    required this.composeBarBuilder,
    required this.messageContentBuilder,
    required this.openProfile,
    this.currentUserName,
  });

  /// Builds the channels feature's production composer.
  final ForumComposeBarBuilder composeBarBuilder;

  /// Builds the channels feature's production message renderer.
  final ForumMessageContentBuilder messageContentBuilder;

  /// Opens the profile detail surface for the requested public key.
  final ForumProfileOpener openProfile;

  /// Reads the signed-in author's current display name at the app boundary.
  final String? Function(WidgetRef ref)? currentUserName;
}
