import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';

const conversationAvatarSize = 34.0;
const conversationAvatarGap = 10.0;

const conversationBodyTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 13,
  fontWeight: FontWeight.w400,
  height: 1.6,
  letterSpacing: 0,
);

const conversationAuthorTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 12,
  fontWeight: FontWeight.w700,
  height: 1.42,
  letterSpacing: 0,
);

const conversationTimestampTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 10,
  fontWeight: FontWeight.w400,
  height: 1.4,
  letterSpacing: 0,
);

const conversationDateTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 10,
  fontWeight: FontWeight.w400,
  height: 1.4,
  letterSpacing: 0,
);

const conversationReplyTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 11,
  fontWeight: FontWeight.w500,
  height: 1.4,
  letterSpacing: 0,
);

const conversationComposerTextStyle = TextStyle(
  fontFamily: 'Manrope',
  fontSize: 13,
  fontWeight: FontWeight.w400,
  height: 1.4,
  letterSpacing: 0,
);

Color conversationAccentColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFA1BCE9)
    : const Color(0xFF45669F);

Color conversationInkColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFEEE8F0)
    : const Color(0xFF292632);

Color conversationMutedColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFAAA1B1)
    : const Color(0xFF8B8590);

Color conversationSurfaceColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? context.mobileTokens.paper
    : Colors.white;

EdgeInsets conversationMessageVerticalPadding({
  required bool showAuthor,
  bool followsDayDivider = false,
  double authorSpacing = Grid.eighteen,
}) => EdgeInsets.only(
  top: showAuthor ? (followsDayDivider ? Grid.quarter : authorSpacing) : 0,
);

const conversationReplyIndent = conversationAvatarSize + conversationAvatarGap;

const conversationAvatarRadius = 11.0;
const conversationMiniAvatarSize = 17.0;
const conversationMiniAvatarRadius = 5.0;

class ConversationAgentBadge extends StatelessWidget {
  const ConversationAgentBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('conversation-agent-badge'),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFFE7EEE8),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFFD4E2D6)),
      ),
      child: const Text(
        'AGENT',
        style: TextStyle(
          fontFamily: 'Manrope',
          fontSize: 8,
          fontWeight: FontWeight.w700,
          height: 1,
          color: Color(0xFF678371),
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}
