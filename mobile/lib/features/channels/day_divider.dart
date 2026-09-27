import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import 'conversation_styles.dart';

/// In-flow date label. The active date gains a glass capsule when it sticks.
class DayDivider extends StatelessWidget {
  final String label;
  final int? dayTimestamp;
  final ValueListenable<int?>? stickyDayTimestamp;

  const DayDivider({
    super.key,
    required this.label,
    this.dayTimestamp,
    this.stickyDayTimestamp,
  });

  Widget _buildOpacity(BuildContext context, {required bool isSticky}) {
    return ExcludeSemantics(
      excluding: isSticky,
      child: AnimatedOpacity(
        key: dayTimestamp == null
            ? null
            : ValueKey('channel-day-divider-opacity-$dayTimestamp'),
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 120),
        curve: Curves.easeOutCubic,
        opacity: isSticky ? 0 : 1,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              Expanded(
                flex: 2,
                child: Divider(
                  color: context.mobileTokens.line,
                  height: 1,
                  thickness: 1,
                ),
              ),
              const SizedBox(width: 12),
              Flexible(
                flex: 3,
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: conversationDateTextStyle.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: Divider(
                  color: context.mobileTokens.line,
                  height: 1,
                  thickness: 1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final activeTimestamp = stickyDayTimestamp;
    final timestamp = dayTimestamp;
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 43, 0, 0),
      child: Center(
        child: activeTimestamp == null || timestamp == null
            ? _buildOpacity(context, isSticky: false)
            : ValueListenableBuilder<int?>(
                valueListenable: activeTimestamp,
                builder: (context, activeDayTimestamp, _) => _buildOpacity(
                  context,
                  isSticky: activeDayTimestamp == timestamp,
                ),
              ),
      ),
    );
  }
}
