import 'package:buzz/features/channels/day_divider.dart';
import 'package:buzz/features/channels/conversation_styles.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('matches the reference date divider and message rhythm', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: DayDivider(label: 'Today · 24 September')),
      ),
    );

    final verticalSpacing = tester.widget<Padding>(
      find
          .descendant(
            of: find.byType(DayDivider),
            matching: find.byType(Padding),
          )
          .first,
    );
    expect(verticalSpacing.padding, const EdgeInsets.fromLTRB(0, 43, 0, 0));
    expect(
      conversationMessageVerticalPadding(
        showAuthor: true,
        followsDayDivider: true,
      ),
      const EdgeInsets.only(top: 2),
    );
    expect(
      conversationMessageVerticalPadding(showAuthor: true),
      const EdgeInsets.only(top: 18),
    );
    expect(
      conversationMessageVerticalPadding(
        showAuthor: true,
        authorSpacing: Grid.sm,
      ),
      const EdgeInsets.only(top: 24),
    );
    expect(
      conversationMessageVerticalPadding(showAuthor: true, authorSpacing: 27),
      const EdgeInsets.only(top: 27),
    );
    expect(find.text('Today · 24 September'), findsOneWidget);
  });

  testWidgets('fades the in-flow date while that day is sticky', (
    tester,
  ) async {
    final stickyDayTimestamp = ValueNotifier<int?>(null);
    addTearDown(stickyDayTimestamp.dispose);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: DayDivider(
            label: 'Today',
            dayTimestamp: 1000,
            stickyDayTimestamp: stickyDayTimestamp,
          ),
        ),
      ),
    );

    AnimatedOpacity opacity() => tester.widget<AnimatedOpacity>(
      find.byKey(const ValueKey('channel-day-divider-opacity-1000')),
    );

    expect(opacity().opacity, 1);

    stickyDayTimestamp.value = 1000;
    await tester.pump();

    expect(opacity().opacity, 0);
    expect(opacity().duration, const Duration(milliseconds: 120));
    expect(opacity().curve, Curves.easeOutCubic);

    stickyDayTimestamp.value = null;
    await tester.pump();

    expect(opacity().opacity, 1);
  });
}
