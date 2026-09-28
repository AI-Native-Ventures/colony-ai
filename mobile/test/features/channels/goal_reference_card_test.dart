import 'dart:convert';

import 'package:buzz/features/channels/goal_reference_card.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/company/goals/goal_records.dart';
import 'package:buzz/shared/company/goals/goal_repository.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:nostr/nostr.dart' as nostr;

const _goalId = '123e4567-e89b-12d3-a456-426614174000';
const _channelId = '223e4567-e89b-12d3-a456-426614174000';
const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _ownerPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

void main() {
  testWidgets('opens the exact goal from a signed reference card', (
    tester,
  ) async {
    final record = _record(status: 'active');
    await tester.pumpWidget(_referenceApp(records: [record]));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));

    expect(find.text('Every client plan, ready on time'), findsOneWidget);
    expect(find.text('On track'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('goal-reference-card:$_goalId')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Goal detail route: $_goalId'), findsOneWidget);
  });

  testWidgets('renders the contract deleted marker and retains the link', (
    tester,
  ) async {
    final record = _record(status: 'deleted');
    await tester.pumpWidget(_referenceApp(records: [record]));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));

    expect(find.text('Deleted goal'), findsOneWidget);
    expect(find.text('Every client plan, ready on time'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('goal-reference-card:$_goalId')),
      findsOneWidget,
    );
  });

  testWidgets('renders the contract unavailable label for an unresolved id', (
    tester,
  ) async {
    await tester.pumpWidget(_referenceApp(records: const []));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));

    expect(find.text('Goal unavailable'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('goal-reference-card:$_goalId')),
      findsOneWidget,
    );
  });

  testWidgets('renders unavailable when fetching the referenced goal fails', (
    tester,
  ) async {
    await tester.pumpWidget(
      _referenceApp(records: const [], loadError: StateError('relay offline')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Goal unavailable'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('goal-reference-card:$_goalId')),
      findsOneWidget,
    );
  });

  testWidgets('shows the banner only for a goal linked to this channel', (
    tester,
  ) async {
    final linked = _record(status: 'active', linkedChannelIds: [_channelId]);
    var openedGoalId = '';
    await tester.pumpWidget(
      _bannerApp(
        records: [linked],
        onOpenGoal: (goalId) => openedGoalId = goalId,
      ),
    );
    await tester.pumpAndSettle();

    final banner = find.byKey(const ValueKey('channel-shared-goal:$_goalId'));
    expect(banner, findsOneWidget);
    expect(find.text('Every client plan, ready on time'), findsOneWidget);
    expect(find.byIcon(LucideIcons.chevronRight), findsNothing);
    final title = tester.widget<Text>(
      find.text('Every client plan, ready on time'),
    );
    final subtitle = tester.widget<Text>(find.text('Shared goal · On track'));
    expect(title.style?.fontSize, 11);
    expect(title.style?.height, 1.6);
    expect(title.style?.fontWeight, FontWeight.w700);
    expect(subtitle.style?.fontSize, 10);
    expect(subtitle.style?.height, 1.6);
    expect(subtitle.style?.color, title.style?.color);
    expect(
      tester.widget<Icon>(find.byIcon(LucideIcons.target)).size,
      MobileLayoutTokens.goalReferenceIconSize,
    );
    await tester.tap(banner);
    expect(openedGoalId, _goalId);
  });

  testWidgets('formats the linked goal due date with its full month', (
    tester,
  ) async {
    final linked = _record(
      status: 'active',
      linkedChannelIds: [_channelId],
      dueDate: '2030-09-30',
    );
    await tester.pumpWidget(_bannerApp(records: [linked]));
    await tester.pumpAndSettle();

    expect(find.text('Shared goal · Due 30 September'), findsOneWidget);
  });

  testWidgets('hides the banner for unlinked and deleted goals', (
    tester,
  ) async {
    await tester.pumpWidget(_bannerApp(records: [_record(status: 'active')]));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('channel-shared-goal:$_goalId')),
      findsNothing,
    );

    await tester.pumpWidget(
      _bannerApp(
        records: [
          _record(status: 'deleted', linkedChannelIds: [_channelId]),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('channel-shared-goal:$_goalId')),
      findsNothing,
    );
  });
}

Widget _referenceApp({
  required List<GoalHeadRecord> records,
  Object? loadError,
}) {
  final routes = MobileRouteRegistry.empty().register(
    MobileBusinessRoutes.goalDetail,
    (_, goalId) => Text('Goal detail route: $goalId'),
  );
  return ProviderScope(
    retry: (_, _) => null,
    overrides: [
      goalHeadsProvider.overrideWith((ref) async {
        if (loadError != null) throw loadError;
        return records;
      }),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      home: MobileRouteScope(
        registry: routes,
        child: Scaffold(
          body: Center(child: GoalReferenceCard(goalId: _goalId)),
        ),
      ),
    ),
  );
}

Widget _bannerApp({
  required List<GoalHeadRecord> records,
  ValueChanged<String>? onOpenGoal,
}) => ProviderScope(
  overrides: [goalHeadsProvider.overrideWith((ref) async => records)],
  child: MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: Center(
        child: ChannelGoalBannerSlot(
          channelId: _channelId,
          onOpenGoal: onOpenGoal ?? (_) {},
        ),
      ),
    ),
  ),
);

GoalHeadRecord _record({
  required String status,
  List<String> linkedChannelIds = const [],
  String? dueDate,
}) {
  final content = jsonEncode({
    'schemaVersion': 1,
    'goalId': _goalId,
    'status': status,
    'title': 'Every client plan, ready on time',
    if (status != 'deleted')
      'goal': {
        'schemaVersion': 1,
        'goalId': _goalId,
        'title': 'Every client plan, ready on time',
        'ownerPubkey': _ownerPubkey,
        'doneCondition': 'Every active client has an approved plan.',
        'linkedChannelIds': linkedChannelIds,
        ...?dueDate != null ? {'dueDate': dueDate} : null,
      },
    'sourceActionEventId': List.filled(64, 'f').join(),
  });
  final signed = nostr.Event.from(
    kind: EventKind.goalHead,
    content: content,
    tags: [
      ['d', goalDTag(_goalId)],
    ],
    secretKey: _relaySecret,
    createdAt: 1758700000,
    verify: false,
  );
  final event = NostrEvent.fromJson(signed.toMap());
  return parseGoalHeadEvent(event, event.pubkey)!;
}
