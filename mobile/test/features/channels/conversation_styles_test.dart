import 'package:buzz/features/channels/conversation_styles.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('uses the reference ink, muted and accent colors', (
    tester,
  ) async {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      late Color ink;
      late Color muted;
      late Color accent;
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
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(
        ink,
        brightness == Brightness.dark
            ? const Color(0xFFEEE8F0)
            : const Color(0xFF292632),
      );
      expect(
        muted,
        brightness == Brightness.dark
            ? const Color(0xFFAAA1B1)
            : const Color(0xFF8B8590),
      );
      expect(
        accent,
        brightness == Brightness.dark
            ? const Color(0xFFA1BCE9)
            : const Color(0xFF45669F),
      );
    }
  });
}
