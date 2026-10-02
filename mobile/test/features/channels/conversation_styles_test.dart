import 'package:buzz/features/channels/conversation_styles.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('uses the shared v5 ink, muted and plum tokens', (tester) async {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      late Color ink;
      late Color muted;
      late Color accent;
      late Color expectedInk;
      late Color expectedMuted;
      late Color expectedAccent;
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Theme(
            data: brightness == Brightness.dark
                ? AppTheme.dark()
                : AppTheme.light(),
            child: Builder(
              builder: (context) {
                ink = conversationInkColor(context);
                muted = conversationMutedColor(context);
                accent = conversationAccentColor(context);
                expectedInk = context.mobileTokens.ink;
                expectedMuted = context.mobileTokens.muted;
                expectedAccent = context.appColors.plum;
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(ink, expectedInk);
      expect(muted, expectedMuted);
      expect(accent, expectedAccent);
    }
  });
}
