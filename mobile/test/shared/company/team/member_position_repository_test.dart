import 'dart:convert';

import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/company/team/member_position_repository.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _target =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _manager =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const _headEventId =
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

void main() {
  group('MemberPositionRepository', () {
    test('reads only relay-signed heads with a bounded query', () async {
      final event = _signedHead();
      final gateway = _FakeGateway(events: [event]);

      final heads = await MemberPositionRepository(
        gateway,
      ).loadHeads(relaySelf: event.pubkey);

      expect(heads.single.head.pubkey, _target);
      expect(gateway.filters.single.kinds, [EventKind.memberPositionHead]);
      expect(gateway.filters.single.authors, [event.pubkey]);
      expect(gateway.filters.single.limit, memberPositionHeadQueryLimit + 1);
      await expectLater(
        MemberPositionRepository(gateway).loadHeads(relaySelf: null),
        throwsA(isA<StateError>()),
      );
    });

    test(
      'publishes an exact-head atomic position command at its d-tag',
      () async {
        final gateway = _FakeGateway();
        const action = MemberPositionAction(
          pubkey: _target,
          action: MemberPositionActionKind.setPosition,
          expectedHeadEventId: _headEventId,
          title: 'Operations lead',
          changesManager: true,
          managerPubkey: _manager,
        );

        await MemberPositionRepository(gateway).submit(action);

        expect(gateway.publishedKind, EventKind.memberPositionAction);
        expect(gateway.publishedTags, [
          ['d', memberPositionDTag(_target)],
        ]);
        expect(jsonDecode(gateway.publishedContent!), {
          'schemaVersion': 1,
          'pubkey': _target,
          'action': 'set_position',
          'expectedHeadEventId': _headEventId,
          'title': 'Operations lead',
          'managerPubkey': _manager,
        });
      },
    );
  });
}

NostrEvent _signedHead() => NostrEvent.fromJson(
  nostr.Event.from(
    kind: EventKind.memberPositionHead,
    content: jsonEncode({
      'schemaVersion': 1,
      'pubkey': _target,
      'title': 'Test title',
      'kind': 'human',
      'status': 'active',
      'sourceActionEventId': _headEventId,
      'updatedAt': '2026-09-28T10:00:00Z',
    }),
    tags: [
      ['d', memberPositionDTag(_target)],
    ],
    secretKey: _relaySecret,
    createdAt: 1758700000,
    verify: false,
  ).toMap(),
);

class _FakeGateway implements MemberPositionGateway {
  _FakeGateway({this.events = const []});

  final List<NostrEvent> events;
  final filters = <NostrFilter>[];
  int? publishedKind;
  String? publishedContent;
  List<List<String>>? publishedTags;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    filters.add(filter);
    return events;
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
    return NostrEvent(
      id: _headEventId,
      pubkey: _target,
      createdAt: 1,
      kind: kind,
      tags: tags,
      content: content,
      sig: '',
    );
  }
}
