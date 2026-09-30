import 'dart:convert';

import 'package:buzz/features/goals/goal_lifecycle_pages.dart';
import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/company/goals/goal_records.dart';
import 'package:buzz/shared/company/goals/goal_repository.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _goalId = '123e4567-e89b-12d3-a456-426614174000';
const _owner =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _reader =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

void main() {
  testWidgets(
    'failed title save keeps typed text and sends only title update',
    (tester) async {
      final record = _goalHead();
      final gateway = _FakeGoalGateway(throwOnPublish: true);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            goalHeadsProvider.overrideWith((ref) async => [record]),
            goalRepositoryProvider.overrideWithValue(GoalRepository(gateway)),
            currentCommunityRoleProvider.overrideWithValue(
              const AsyncData(CommunityMemberRole.owner),
            ),
            activeCommunityProvider.overrideWith((ref) async => null),
            myPubkeyProvider.overrideWithValue(_owner),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: const GoalEditPage(goalId: _goalId),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final titleField = find.byType(TextField).first;
      await tester.enterText(titleField, 'Changed goal title');
      await tester.tap(find.text('Save title'));
      await tester.pumpAndSettle();

      expect(
        tester.widget<TextField>(titleField).controller!.text,
        'Changed goal title',
      );
      expect(find.text('Save title'), findsOneWidget);
      expect(find.text('Could not save'), findsOneWidget);
      expect(
        find.text('Your entries are still here. Retry this action.'),
        findsOneWidget,
      );
      final action =
          jsonDecode(gateway.publishedContent!) as Map<String, Object?>;
      expect(action['action'], 'update');
      expect(
        (action['goal'] as Map<String, Object?>)['title'],
        'Changed goal title',
      );
      expect(gateway.publishedCount, 1);
    },
  );

  testWidgets('partial save keeps the failed field editable', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var latest = _goalHead();
    final gateway = _FakeGoalGateway(
      failOnPublishNumber: 2,
      onPublish: (count, content) {
        final action = jsonDecode(content) as Map<String, Object?>;
        final goal = action['goal']! as Map<String, Object?>;
        latest = _goalHead(
          title: goal['title']! as String,
          condition: goal['doneCondition']! as String,
          eventId: 'goal-head-$count',
        );
      },
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          goalHeadsProvider.overrideWith((ref) async => [latest]),
          goalRepositoryProvider.overrideWithValue(GoalRepository(gateway)),
          currentCommunityRoleProvider.overrideWithValue(
            const AsyncData(CommunityMemberRole.owner),
          ),
          activeCommunityProvider.overrideWith((ref) async => null),
          myPubkeyProvider.overrideWithValue(_owner),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const GoalEditPage(goalId: _goalId),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'Updated goal title');
    await tester.tap(find.text('Save title'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), 'Ready to launch.');
    await tester.scrollUntilVisible(
      find.text('Save done condition'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save done condition'));
    await tester.pumpAndSettle();

    expect(gateway.publishedCount, 2);
    expect(latest.head.goal!.title, 'Updated goal title');
    expect(
      tester.widget<TextField>(find.byType(TextField).at(1)).controller!.text,
      'Ready to launch.',
    );
    expect(find.text('Retry done condition'), findsOneWidget);
    expect(find.text('Save done condition'), findsNothing);
    expect(latest.head.goal!.doneCondition, 'The project is ready.');

    await tester.drag(find.byType(ListView).first, const Offset(0, 1000));
    await tester.pumpAndSettle();
    expect(find.text('Title saved. Done condition failed.'), findsOneWidget);
    expect(
      find.text(
        'Your done condition is still typed below. Status has not been changed.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('viewer sees denied state only after opening Edit goal', (
    tester,
  ) async {
    final record = _goalHead();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          goalHeadsProvider.overrideWith((ref) async => [record]),
          currentCommunityRoleProvider.overrideWithValue(
            const AsyncData(CommunityMemberRole.member),
          ),
          activeCommunityProvider.overrideWith((ref) async => null),
          myPubkeyProvider.overrideWithValue(_reader),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const GoalActionsPage(goalId: _goalId),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('You cannot edit this goal'), findsNothing);
    await tester.tap(find.text('Edit goal'));
    await tester.pumpAndSettle();

    expect(find.text('You cannot edit this goal'), findsOneWidget);
    expect(
      find.text(
        'Your role allows you to read it. Ask the goal owner or an authorized manager to change it.',
      ),
      findsOneWidget,
    );
  });
}

GoalHeadRecord _goalHead({
  String title = 'Current goal title',
  String condition = 'The project is ready.',
  String eventId = 'goal-head-one',
}) => GoalHeadRecord(
  dTag: 'company:goal:$_goalId',
  event: NostrEvent(
    id: eventId,
    pubkey: _owner,
    createdAt: 1,
    kind: EventKind.goalHead,
    tags: const [],
    content: '',
    sig: '',
  ),
  head: GoalHead(
    schemaVersion: 1,
    goalId: _goalId,
    status: GoalStatus.active,
    title: title,
    sourceActionEventId: 'source-action',
    goal: GoalRecord(
      schemaVersion: 1,
      goalId: _goalId,
      title: title,
      ownerPubkey: _owner,
      doneCondition: condition,
      linkedChannelIds: const [],
    ),
  ),
);

class _FakeGoalGateway implements GoalRecordGateway {
  _FakeGoalGateway({
    this.throwOnPublish = false,
    this.failOnPublishNumber,
    this.onPublish,
  });

  final bool throwOnPublish;
  final int? failOnPublishNumber;
  final void Function(int count, String content)? onPublish;
  String? publishedContent;
  int publishedCount = 0;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async => const [];

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    publishedContent = content;
    publishedCount++;
    if (throwOnPublish || publishedCount == failOnPublishNumber) {
      throw StateError('relay unavailable');
    }
    onPublish?.call(publishedCount, content);
    return const NostrEvent(
      id: 'goal-action-ack',
      pubkey: _owner,
      createdAt: 2,
      kind: EventKind.goalAction,
      tags: [],
      content: '',
      sig: '',
    );
  }
}
