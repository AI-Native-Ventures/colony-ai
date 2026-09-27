import 'package:buzz/features/channels/message_action_backdrop_state.dart';
import 'package:buzz/features/channels/sticky_date_header.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'keeps the iOS date divider compact and stationary during push-off',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final state = ValueNotifier(
        const StickyDateHeaderState(label: 'Yesterday'),
      );
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(body: StickyDateHeader(state: state)),
          ),
        );

        expect(find.byType(UiKitView), findsNothing);
        expect(find.byType(BackdropFilter), findsNothing);
        expect(find.text('Yesterday'), findsOneWidget);
        final dateLabel = find.descendant(
          of: find.byType(StickyDateHeader),
          matching: find.byType(Text),
        );
        expect(
          tester.getSize(dateLabel).width,
          lessThan(tester.getSize(find.byType(StickyDateHeader)).width),
        );
        final stickyHeight = StickyDateHeader.heightOf(
          tester.element(find.byType(StickyDateHeader)),
        );
        expect(
          tester.getSize(find.byType(StickyDateHeader)).height,
          stickyHeight,
        );
        expect(tester.getSize(dateLabel).height, lessThan(stickyHeight));
        expect(
          find.byKey(const ValueKey('sticky-date-header-clip')),
          findsNothing,
        );
        final initialSurfaceTop = tester.getTopLeft(dateLabel).dy;
        state.value = StickyDateHeaderState(
          label: 'Yesterday',
          translateY: -(stickyHeight + 5) / 2,
        );
        await tester.pump();
        expect(
          tester
              .widget<Opacity>(
                find.byKey(const ValueKey('sticky-date-push-off-opacity')),
              )
              .opacity,
          closeTo(0.5, 0.001),
        );
        expect(
          tester.getTopLeft(dateLabel).dy,
          closeTo(initialSurfaceTop, 0.01),
          reason: 'The date label stays in place while the sticky row fades.',
        );

        state.value = StickyDateHeaderState(
          label: 'Yesterday',
          translateY: -(stickyHeight + 5),
        );
        await tester.pump();
        expect(
          tester
              .widget<Opacity>(
                find.byKey(const ValueKey('sticky-date-push-off-opacity')),
              )
              .opacity,
          0,
        );

        state.value = const StickyDateHeaderState(label: 'Today');
        await tester.pump();
        expect(find.text('Today'), findsOneWidget);
        expect(
          tester
              .widget<Opacity>(
                find.byKey(const ValueKey('sticky-date-push-off-opacity')),
              )
              .opacity,
          1,
        );

        messageActionBackdropActive.value = true;
        await tester.pump();
        expect(find.byType(UiKitView), findsNothing);
        expect(find.byType(BackdropFilter), findsNothing);
        expect(
          find.byKey(const ValueKey('sticky-date-header-clip')),
          findsNothing,
        );
        expect(
          tester.getSize(dateLabel).width,
          lessThan(tester.getSize(find.byType(StickyDateHeader)).width),
        );
      } finally {
        messageActionBackdropActive.value = false;
        state.dispose();
        debugDefaultTargetPlatformOverride = null;
      }
    },
  );

  testWidgets('keeps the compact Flutter date divider on Android', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final state = ValueNotifier(const StickyDateHeaderState(label: 'Today'));
    try {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(body: StickyDateHeader(state: state)),
        ),
      );

      expect(find.byType(UiKitView), findsNothing);
      expect(find.byType(BackdropFilter), findsNothing);
      expect(find.text('Today'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('sticky-date-header-clip')),
        findsNothing,
      );
      final dateLabel = find.descendant(
        of: find.byType(StickyDateHeader),
        matching: find.byType(Text),
      );
      final initialSurfaceTop = tester.getTopLeft(dateLabel).dy;
      final stickyHeight = StickyDateHeader.heightOf(
        tester.element(find.byType(StickyDateHeader)),
      );

      state.value = StickyDateHeaderState(
        label: 'Today',
        translateY: -(stickyHeight + 5) / 2,
      );
      await tester.pump();
      expect(
        tester
            .widget<Opacity>(
              find.byKey(const ValueKey('sticky-date-push-off-opacity')),
            )
            .opacity,
        closeTo(0.5, 0.001),
      );
      expect(
        tester.getTopLeft(dateLabel).dy,
        closeTo(initialSurfaceTop, 0.01),
        reason: 'Android uses the same stationary date handoff as iOS.',
      );
      expect(
        tester.getSize(dateLabel).width,
        lessThan(tester.getSize(find.byType(StickyDateHeader)).width),
      );
    } finally {
      state.dispose();
      debugDefaultTargetPlatformOverride = null;
    }
  });
}
