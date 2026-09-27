import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import 'conversation_styles.dart';

/// The active date and vertical push-off applied to a sticky date header.
@immutable
class StickyDateHeaderState {
  final String? label;
  final double translateY;

  const StickyDateHeaderState({this.label, this.translateY = 0});

  static const hidden = StickyDateHeaderState();

  bool get isVisible => label != null;

  @override
  bool operator ==(Object other) =>
      other is StickyDateHeaderState &&
      other.label == label &&
      other.translateY == translateY;

  @override
  int get hashCode => Object.hash(label, translateY);
}

/// A centered date label with hairlines that remains below the app bar.
class StickyDateHeader extends StatelessWidget {
  final ValueListenable<StickyDateHeaderState> state;

  const StickyDateHeader({required this.state, super.key});

  static double heightOf(BuildContext context) {
    final lineHeight =
        (conversationDateTextStyle.fontSize ?? 10) *
        (conversationDateTextStyle.height ?? 1.2);
    return MediaQuery.textScalerOf(context).scale(lineHeight) + Grid.xs;
  }

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);

    return ValueListenableBuilder<StickyDateHeaderState>(
      valueListenable: state,
      builder: (context, value, _) {
        final stickyHeight = heightOf(context);
        final pushOffProgress = (-value.translateY / (stickyHeight + 5)).clamp(
          0.0,
          1.0,
        );
        return SizedBox(
          height: stickyHeight,
          child: IgnorePointer(
            child: ExcludeSemantics(
              excluding: !value.isVisible,
              child: AnimatedOpacity(
                duration: reducedMotion
                    ? Duration.zero
                    : const Duration(milliseconds: 120),
                curve: Curves.easeOutCubic,
                opacity: value.isVisible ? 1 : 0,
                child: Opacity(
                  key: const ValueKey('sticky-date-push-off-opacity'),
                  opacity: 1 - pushOffProgress,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Semantics(
                      header: true,
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
                              value.label ?? '',
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
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
