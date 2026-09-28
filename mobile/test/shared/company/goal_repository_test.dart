import 'dart:convert';

import 'package:buzz/shared/company/goals/goal_records.dart';
import 'package:buzz/shared/company/goals/goal_repository.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:nostr/nostr.dart' as nostr;

const _goalId = '123e4567-e89b-12d3-a456-426614174000';
const _goalDTag = 'company:goal:$_goalId';
const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _ownerSecret =
    '2222222222222222222222222222222222222222222222222222222222222222';

void main() {
  group('GoalRepository', () {
    test(
      'fetches verified heads only from the relay signer and fails closed',
      () async {
        final relayHead = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', _goalDTag],
          ],
          content: jsonEncode(_headContent()),
        );
        final gateway = _FakeGoalGateway([relayHead]);
        final repository = GoalRepository(gateway);

        final heads = await repository.loadHeads(relaySelf: relayHead.pubkey);

        expect(heads.single.head.goalId, _goalId);
        expect(gateway.filters.single.kinds, [EventKind.goalHead]);
        expect(gateway.filters.single.authors, [relayHead.pubkey]);
        expect(gateway.filters.single.tags, isEmpty);
        expect(gateway.filters.single.limit, goalHeadQueryLimit);
        await expectLater(
          repository.loadHeads(relaySelf: null),
          throwsA(isA<StateError>()),
        );
      },
    );

    test(
      'loads the global action history by d tag and checks signatures',
      () async {
        final older = _signedEvent(
          secret: _ownerSecret,
          kind: EventKind.goalAction,
          tags: [
            ['d', _goalDTag],
          ],
          createdAt: 100,
          content: jsonEncode(_progressAction(current: '1')),
        );
        final newer = _signedEvent(
          secret: _ownerSecret,
          kind: EventKind.goalAction,
          tags: [
            ['d', _goalDTag],
          ],
          createdAt: 200,
          content: jsonEncode(_progressAction(current: '2')),
        );
        final gateway = _FakeGoalGateway([older, newer]);
        final actions = await GoalRepository(gateway).loadHistory(_goalId);

        expect(gateway.filters.single.kinds, [EventKind.goalAction]);
        expect(gateway.filters.single.tags, {
          '#d': [_goalDTag],
        });
        expect(gateway.filters.single.limit, goalHistoryQueryLimit);
        expect(actions.map((record) => record.event.createdAt), [200, 100]);
        expect(actions.first.action.progress!.current, '2');
      },
    );

    test(
      'publishes goal actions as global kind 47031 with only the d tag',
      () async {
        final gateway = _FakeGoalGateway(const []);
        const action = GoalAction(
          goalId: _goalId,
          action: GoalActionType.progress,
          expectedHeadEventId:
              'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          progress: GoalProgress(
            current: '4',
            evidence: 'The latest plan is approved.',
          ),
        );

        await GoalRepository(gateway).submit(action);

        expect(gateway.publishedKind, EventKind.goalAction);
        expect(gateway.publishedTags, [
          ['d', _goalDTag],
        ]);
        final content =
            jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
        expect(content['action'], 'progress');
        expect(content['progress']['current'], '4');
        expect(content.containsKey('status'), isFalse);
      },
    );
  });

  group('Goal NIP-11 self lookup', () {
    test('reads the advertised relay signing identity', () async {
      final client = MockClient((request) async {
        expect(request.headers['accept'], 'application/nostr+json');
        return http.Response(
          jsonEncode({'self': List.filled(64, 'a').join()}),
          200,
        );
      });

      expect(
        await fetchGoalRelaySelf('https://relay.example', client: client),
        List.filled(64, 'a').join(),
      );
    });

    test(
      'distinguishes absent self from a failed or malformed document',
      () async {
        final absent = MockClient((_) async => http.Response('{}', 200));
        final malformed = MockClient(
          (_) async => http.Response('{"self":"bad"}', 200),
        );
        final failed = MockClient(
          (_) async => http.Response('unavailable', 503),
        );

        expect(
          await fetchGoalRelaySelf('https://relay.example', client: absent),
          isNull,
        );
        await expectLater(
          fetchGoalRelaySelf('https://relay.example', client: malformed),
          throwsA(isA<FormatException>()),
        );
        await expectLater(
          fetchGoalRelaySelf('https://relay.example', client: failed),
          throwsA(isA<StateError>()),
        );
      },
    );
  });
}

Map<String, Object?> _headContent() => {
  'schemaVersion': 1,
  'goalId': _goalId,
  'status': 'active',
  'title': 'Quarterly outcome',
  'goal': {
    'schemaVersion': 1,
    'goalId': _goalId,
    'title': 'Quarterly outcome',
    'ownerPubkey': List.filled(64, 'a').join(),
    'doneCondition': 'The outcome is complete.',
    'linkedChannelIds': <String>[],
  },
  'sourceActionEventId': List.filled(64, 'f').join(),
};

Map<String, Object?> _progressAction({required String current}) => {
  'schemaVersion': 1,
  'goalId': _goalId,
  'action': 'progress',
  'expectedHeadEventId': List.filled(64, 'f').join(),
  'progress': {
    'current': current,
    'evidence': 'A verified update.',
    'evidenceRefs': <String>[],
  },
};

NostrEvent _signedEvent({
  required String secret,
  required int kind,
  required List<List<String>> tags,
  required String content,
  int createdAt = 1758700000,
}) => NostrEvent.fromJson(
  nostr.Event.from(
    kind: kind,
    content: content,
    tags: tags,
    secretKey: secret,
    createdAt: createdAt,
    verify: false,
  ).toMap(),
);

class _FakeGoalGateway implements GoalRecordGateway {
  _FakeGoalGateway(this.events);

  final List<NostrEvent> events;
  final filters = <NostrFilter>[];
  int? publishedKind;
  String? publishedContent;
  List<List<String>>? publishedTags;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    filters.add(filter);
    return events.where((event) => filter.kinds.contains(event.kind)).toList();
  }

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    publishedKind = kind;
    publishedContent = content;
    publishedTags = tags;
    return const NostrEvent(
      id: 'a',
      pubkey: 'b',
      createdAt: 1,
      kind: EventKind.goalAction,
      tags: [],
      content: '',
      sig: 'c',
    );
  }
}
