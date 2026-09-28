import 'package:flutter/material.dart';

import '../../shared/identity/identity_components.dart';
import '../../shared/theme/theme.dart';

const conversationAvatarSize = 28.0;
const conversationAvatarGap = 10.0;
const conversationSystemMessageTopPadding = Grid.sm + Grid.fourteen;

final conversationBodyTextStyle = MobileTypographyTokens.v5.conversation;

final conversationAuthorTextStyle = MobileTypographyTokens.v5.identityName;

final conversationTimestampTextStyle = MobileTypographyTokens.v5.identityStatus;

final conversationDateTextStyle = MobileTypographyTokens.v5.identityStatus;

final conversationReplyTextStyle = MobileTypographyTokens.v5.identityDetails;

final conversationComposerTextStyle = MobileTypographyTokens.v5.conversation;

Color conversationAccentColor(BuildContext context) => context.appColors.plum;

Color conversationInkColor(BuildContext context) => context.mobileTokens.ink;

Color conversationMutedColor(BuildContext context) =>
    context.mobileTokens.muted;

Color conversationSurfaceColor(BuildContext context) =>
    context.mobileTokens.canvas;

EdgeInsets conversationMessageVerticalPadding({
  required bool showAuthor,
  bool followsDayDivider = false,
  double authorSpacing = Grid.eighteen,
}) => EdgeInsets.only(
  top: showAuthor ? (followsDayDivider ? Grid.quarter : authorSpacing) : 0,
);

const conversationReplyIndent = conversationAvatarSize + conversationAvatarGap;

const conversationMiniAvatarSize = 17.0;

class ConversationAgentBadge extends StatelessWidget {
  const ConversationAgentBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return const IdentityAgentBadge(key: ValueKey('conversation-agent-badge'));
  }
}
