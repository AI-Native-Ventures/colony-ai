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
      expect(find.textContaining('Your text is still here'), findsOneWidget);
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

GoalHeadRecord _goalHead() => const GoalHeadRecord(
  dTag: 'company:goal:$_goalId',
  event: NostrEvent(
    id: 'goal-head-one',
    pubkey: _owner,
    createdAt: 1,
    kind: EventKind.goalHead,
    tags: [],
    content: '',
    sig: '',
  ),
  head: GoalHead(
    schemaVersion: 1,
    goalId: _goalId,
    status: GoalStatus.active,
    title: 'Current goal title',
    sourceActionEventId: 'source-action',
    goal: GoalRecord(
      schemaVersion: 1,
      goalId: _goalId,
      title: 'Current goal title',
      ownerPubkey: _owner,
      doneCondition: 'The project is ready.',
      linkedChannelIds: [],
    ),
  ),
);

class _FakeGoalGateway implements GoalRecordGateway {
  _FakeGoalGateway({required this.throwOnPublish});

  final bool throwOnPublish;
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
    if (throwOnPublish) throw StateError('relay unavailable');
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
