import 'dart:convert';

import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _humanPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _managerPubkey =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _headEventId =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

void main() {
  group('Member-position records', () {
    test('parses a relay-signed employee head at its exact coordinate', () {
      final event = _signedHead(
        kind: 'employee',
        status: 'paused',
        reason: 'Review access before the next assignment.',
      );

      final parsed = parseMemberPositionHeadEvent(event, event.pubkey);

      expect(parsed, isNotNull);
      expect(parsed!.dTag, memberPositionDTag(_humanPubkey));
      expect(parsed.head.pubkey, _humanPubkey);
      expect(parsed.head.title, 'Operations lead');
      expect(parsed.head.managerPubkey, _managerPubkey);
      expect(parsed.head.kind, MemberPositionKind.employee);
      expect(parsed.head.status, MemberPositionStatus.paused);
      expect(parsed.head.reason, 'Review access before the next assignment.');
    });

    test(
      'rejects wrong relay, tampered content, scope and invalid lifecycle',
      () {
        final valid = _signedHead();
        final tampered = NostrEvent(
          id: valid.id,
          pubkey: valid.pubkey,
          createdAt: valid.createdAt,
          kind: valid.kind,
          tags: valid.tags,
          content: '{}',
          sig: valid.sig,
        );
        final scoped = _signedHead(
          tags: [
            ['d', memberPositionDTag(_humanPubkey)],
            ['h', 'community-channel'],
          ],
        );
        final humanPaused = _signedHead(kind: 'human', status: 'paused');

        expect(parseMemberPositionHeadEvent(valid, _managerPubkey), isNull);
        expect(parseMemberPositionHeadEvent(tampered, valid.pubkey), isNull);
        expect(parseMemberPositionHeadEvent(scoped, valid.pubkey), isNull);
        expect(parseMemberPositionHeadEvent(humanPaused, valid.pubkey), isNull);
      },
    );

    test('serializes manager clearing and lifecycle reasons exactly', () {
      const setPosition = MemberPositionAction(
        pubkey: _humanPubkey,
        action: MemberPositionActionKind.setPosition,
        expectedHeadEventId: _headEventId,
        title: 'Operations lead',
        changesManager: true,
        managerPubkey: null,
      );
      const pause = MemberPositionAction(
        pubkey: _humanPubkey,
        action: MemberPositionActionKind.pause,
        expectedHeadEventId: _headEventId,
        reason: 'Pause until the review is complete.',
      );

      expect(validateMemberPositionAction(setPosition), isNull);
      expect(setPosition.toJson(), {
        'schemaVersion': 1,
        'pubkey': _humanPubkey,
        'action': 'set_position',
        'expectedHeadEventId': _headEventId,
        'title': 'Operations lead',
        'managerPubkey': null,
      });
      expect(validateMemberPositionAction(pause), isNull);
      expect(pause.toJson()['reason'], 'Pause until the review is complete.');
      expect(
        validateMemberPositionAction(
          const MemberPositionAction(
            pubkey: _humanPubkey,
            action: MemberPositionActionKind.terminate,
            expectedHeadEventId: _headEventId,
          ),
        ),
        isNotNull,
      );
    });
  });
}

NostrEvent _signedHead({
  String kind = 'human',
  String status = 'active',
  String? reason,
  List<List<String>>? tags,
}) => NostrEvent.fromJson(
  nostr.Event.from(
    kind: EventKind.memberPositionHead,
    content: jsonEncode({
      'schemaVersion': 1,
      'pubkey': _humanPubkey,
      'title': 'Operations lead',
      'managerPubkey': _managerPubkey,
      'kind': kind,
      'status': status,
      ..._optionalReason(reason),
      'sourceActionEventId': _headEventId,
      'updatedAt': '2026-09-28T10:00:00Z',
    }),
    tags:
        tags ??
        [
          ['d', memberPositionDTag(_humanPubkey)],
        ],
    secretKey: _relaySecret,
    createdAt: 1758700000,
    verify: false,
  ).toMap(),
);

Map<String, Object?> _optionalReason(String? reason) =>
    reason == null ? const {} : {'reason': reason};
