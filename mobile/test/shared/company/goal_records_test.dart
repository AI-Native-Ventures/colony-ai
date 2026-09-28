import 'dart:convert';

import 'package:buzz/shared/company/goals/goal_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

const _goalId = '123e4567-e89b-12d3-a456-426614174000';
const _channelId = '223e4567-e89b-12d3-a456-426614174000';
const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _ownerSecret =
    '2222222222222222222222222222222222222222222222222222222222222222';
const _ownerPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

void main() {
  group('Goal coordinates and references', () {
    test('builds and parses canonical goal coordinates and links', () {
      expect(goalDTag(_goalId), 'company:goal:$_goalId');
      expect(parseGoalDTag('company:goal:$_goalId'), _goalId);
      expect(buildGoalLink(_goalId), 'buzz://goal/$_goalId');
      expect(parseGoalReferenceUri(Uri.parse('buzz://goal/$_goalId')), _goalId);
    });

    test('rejects ambiguous goal links and malformed coordinates', () {
      expect(parseGoalDTag('company:goal:not-a-uuid'), isNull);
      expect(
        parseGoalReferenceUri(Uri.parse('buzz://goal/$_goalId?x=1')),
        isNull,
      );
      expect(
        parseGoalReferenceUri(Uri.parse('buzz://goal/$_goalId/extra')),
        isNull,
      );
      expect(() => goalDTag('not-a-uuid'), throwsArgumentError);
    });
  });

  group('GoalHead parser', () {
    test(
      'accepts a valid relay-signed global head with real contract fields',
      () {
        final event = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', 'company:goal:$_goalId'],
          ],
          content: jsonEncode(_headContent()),
        );

        final parsed = parseGoalHeadEvent(event, event.pubkey);

        expect(parsed, isNotNull);
        expect(parsed!.head.goalId, _goalId);
        expect(parsed.head.status, GoalStatus.active);
        expect(parsed.head.goal!.target!.unit, 'plans');
        expect(parsed.head.goal!.linkedChannelIds, [_channelId]);
        expect(parsed.head.progress!.current, '4');
      },
    );

    test(
      'rejects wrong relay author, tampering, h tags and coordinate mismatch',
      () {
        final valid = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', 'company:goal:$_goalId'],
          ],
          content: jsonEncode(_headContent()),
        );
        final tampered = NostrEvent(
          id: valid.id,
          pubkey: valid.pubkey,
          createdAt: valid.createdAt,
          kind: valid.kind,
          tags: valid.tags,
          content: '{}',
          sig: valid.sig,
        );
        final withChannelScope = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', 'company:goal:$_goalId'],
            ['h', _channelId],
          ],
          content: jsonEncode(_headContent()),
        );
        final mismatchedCoordinate = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', 'company:goal:$_channelId'],
          ],
          content: jsonEncode(_headContent()),
        );

        expect(parseGoalHeadEvent(valid, _ownerPubkey), isNull);
        expect(parseGoalHeadEvent(tampered, valid.pubkey), isNull);
        expect(parseGoalHeadEvent(withChannelScope, valid.pubkey), isNull);
        expect(parseGoalHeadEvent(mismatchedCoordinate, valid.pubkey), isNull);
      },
    );

    test(
      'keeps a numeric target at 100 percent without changing explicit status',
      () {
        final event = _signedEvent(
          secret: _relaySecret,
          kind: EventKind.goalHead,
          tags: [
            ['d', 'company:goal:$_goalId'],
          ],
          content: jsonEncode(_headContent(current: '4', target: '4')),
        );
        final head = parseGoalHeadEvent(event, event.pubkey)!.head;

        expect(goalProgressRatio(head), 1);
        expect(head.status, GoalStatus.active);
      },
    );

    test('rejects a target head that omits its required current value', () {
      final event = _signedEvent(
        secret: _relaySecret,
        kind: EventKind.goalHead,
        tags: [
          ['d', 'company:goal:$_goalId'],
        ],
        content: jsonEncode(
          _headContent()
            ..['progress'] = {
              'evidence': 'An update without the required current value.',
              'evidenceRefs': <String>[],
              'recordedByPubkey': _ownerPubkey,
              'recordedAt': '2026-09-24T08:30:00Z',
            },
        ),
      );

      expect(parseGoalHeadEvent(event, event.pubkey), isNull);
    });

    test('parses deleted goal heads without fabricating a goal body', () {
      final event = _signedEvent(
        secret: _relaySecret,
        kind: EventKind.goalHead,
        tags: [
          ['d', 'company:goal:$_goalId'],
        ],
        content: jsonEncode({
          'schemaVersion': 1,
          'goalId': _goalId,
          'status': 'deleted',
          'title': 'Quarterly outcome',
          'sourceActionEventId': List.filled(64, 'f').join(),
        }),
      );
      final parsed = parseGoalHeadEvent(event, event.pubkey);

      expect(parsed!.head.status, GoalStatus.deleted);
      expect(parsed.head.goal, isNull);
    });
  });

  group('GoalAction parser and authority', () {
    test('verifies user-signed progress actions and their global d tag', () {
      final dTag = 'company:goal:$_goalId';
      final event = _signedEvent(
        secret: _ownerSecret,
        kind: EventKind.goalAction,
        tags: [
          ['d', dTag],
        ],
        content: jsonEncode({
          'schemaVersion': 1,
          'goalId': _goalId,
          'action': 'progress',
          'expectedHeadEventId': List.filled(64, 'f').join(),
          'progress': {
            'current': '4',
            'evidence': 'The latest plan is approved.',
            'evidenceRefs': <String>[],
          },
        }),
      );

      final parsed = parseGoalActionEvent(event, dTag);

      expect(parsed, isNotNull);
      expect(parsed!.action.progress!.current, '4');
      expect(parsed.action.status, isNull);
      expect(parseGoalActionEvent(event, 'company:goal:$_channelId'), isNull);
    });

    test('rejects bad signatures, channel tags and action payloads', () {
      const dTag = 'company:goal:$_goalId';
      final validAction = {
        'schemaVersion': 1,
        'goalId': _goalId,
        'action': 'progress',
        'expectedHeadEventId': List.filled(64, 'f').join(),
        'progress': {'evidence': 'A real update', 'evidenceRefs': <String>[]},
      };
      final withChannelScope = _signedEvent(
        secret: _ownerSecret,
        kind: EventKind.goalAction,
        tags: [
          ['d', dTag],
          ['h', _channelId],
        ],
        content: jsonEncode(validAction),
      );
      final invalidPayload = _signedEvent(
        secret: _ownerSecret,
        kind: EventKind.goalAction,
        tags: [
          ['d', dTag],
        ],
        content: jsonEncode({
          ...validAction,
          'progress': {'evidence': ''},
        }),
      );
      final valid = _signedEvent(
        secret: _ownerSecret,
        kind: EventKind.goalAction,
        tags: [
          ['d', dTag],
        ],
        content: jsonEncode(validAction),
      );
      final tampered = NostrEvent(
        id: valid.id,
        pubkey: valid.pubkey,
        createdAt: valid.createdAt,
        kind: valid.kind,
        tags: valid.tags,
        content: '{}',
        sig: valid.sig,
      );

      expect(parseGoalActionEvent(withChannelScope, dTag), isNull);
      expect(parseGoalActionEvent(invalidPayload, dTag), isNull);
      expect(parseGoalActionEvent(tampered, dTag), isNull);
    });

    test('requires the current head for every action except create', () {
      const dTag = 'company:goal:$_goalId';
      final action = _signedEvent(
        secret: _ownerSecret,
        kind: EventKind.goalAction,
        tags: [
          ['d', dTag],
        ],
        content: jsonEncode({
          'schemaVersion': 1,
          'goalId': _goalId,
          'action': 'progress',
          'progress': {'evidence': 'A real update', 'evidenceRefs': <String>[]},
        }),
      );

      expect(parseGoalActionEvent(action, dTag), isNull);
    });

    test('grants goal actions only to owner, admin or the goal owner', () {
      final event = _signedEvent(
        secret: _relaySecret,
        kind: EventKind.goalHead,
        tags: [
          ['d', 'company:goal:$_goalId'],
        ],
        content: jsonEncode(_headContent()),
      );
      final head = parseGoalHeadEvent(event, event.pubkey)!.head;

      expect(canManageCompanyGoals('owner'), isTrue);
      expect(canManageCompanyGoals('admin'), isTrue);
      expect(canManageCompanyGoals('member'), isFalse);
      expect(
        canUpdateGoal(role: 'member', actorPubkey: _ownerPubkey, head: head),
        isTrue,
      );
      expect(
        canUpdateGoal(
          role: 'member',
          actorPubkey: List.filled(64, 'b').join(),
          head: head,
        ),
        isFalse,
      );
      expect(canRestoreOrDeleteGoal('member'), isFalse);
    });
  });
}

Map<String, Object?> _headContent({
  String current = '4',
  String target = '4',
}) => {
  'schemaVersion': 1,
  'goalId': _goalId,
  'status': 'active',
  'title': 'Every client plan, ready on time',
  'goal': {
    'schemaVersion': 1,
    'goalId': _goalId,
    'title': 'Every client plan, ready on time',
    'ownerPubkey': _ownerPubkey,
    'dueDate': '2026-09-30',
    'doneCondition': 'Each active client has an approved plan.',
    'target': {'value': target, 'unit': 'plans'},
    'linkedChannelIds': [_channelId],
  },
  'progress': {
    'current': current,
    'evidence': 'The latest client plan is approved.',
    'evidenceRefs': <String>[],
    'recordedByPubkey': _ownerPubkey,
    'recordedAt': '2026-09-24T08:30:00Z',
  },
  'sourceActionEventId': List.filled(64, 'f').join(),
};

NostrEvent _signedEvent({
  required String secret,
  required int kind,
  required List<List<String>> tags,
  required String content,
}) => NostrEvent.fromJson(
  nostr.Event.from(
    kind: kind,
    content: content,
    tags: tags,
    secretKey: secret,
    createdAt: 1758700000,
    verify: false,
  ).toMap(),
);
