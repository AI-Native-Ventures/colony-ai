import 'dart:convert';

import 'package:buzz/shared/company/work/company_work_records.dart';
import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

const _channelOne = '123e4567-e89b-12d3-a456-426614174000';
const _channelTwo = '223e4567-e89b-12d3-a456-426614174000';
const _workOne = '323e4567-e89b-12d3-a456-426614174000';
const _workTwo = '423e4567-e89b-12d3-a456-426614174000';
const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _member =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _otherMember =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

void main() {
  test(
    'loads current work for the selected member from joined stream channels',
    () async {
      final relaySelf = _signedWork(_workOne, _channelOne, _member).pubkey;
      final gateway = _WorkGateway([
        _signedWork(_workOne, _channelOne, _member, title: 'Current plan'),
        _signedWork(
          _workTwo,
          _channelTwo,
          _member,
          title: 'Paused review',
          status: 'paused',
          createdAt: 2,
        ),
        _signedWork(
          '523e4567-e89b-12d3-a456-426614174000',
          _channelTwo,
          _member,
          status: 'archived',
        ),
        _signedWork(
          '623e4567-e89b-12d3-a456-426614174000',
          _channelTwo,
          _otherMember,
        ),
      ]);

      final records = await CompanyWorkRepository(gateway).loadCurrent(
        memberPubkey: _member,
        relaySelf: relaySelf,
        channels: [
          _channel('sales', _channelOne),
          _channel('support', _channelTwo),
        ],
      );

      expect(records.map((record) => record.title), [
        'Paused review',
        'Current plan',
      ]);
      expect(records.first.status, 'paused');
      expect(records.first.channelName, 'support');
      expect(gateway.filters, hasLength(1));
      expect(gateway.filters.single.kinds, [EventKind.workItemHead]);
      expect(gateway.filters.single.authors, [relaySelf]);
      expect(gateway.filters.single.tags['#h'], [_channelOne, _channelTwo]);
    },
  );

  test('does not query archived, non-member, forum or DM channels', () async {
    final relaySelf = _signedWork(_workOne, _channelOne, _member).pubkey;
    final gateway = _WorkGateway(const []);

    final records = await CompanyWorkRepository(gateway).loadCurrent(
      memberPubkey: _member,
      relaySelf: relaySelf,
      channels: [
        _channel('archived', _channelOne, archived: true),
        _channel('not joined', _channelTwo, isMember: false),
        _channel(
          'forum',
          '323e4567-e89b-12d3-a456-426614174000',
          type: 'forum',
        ),
        _channel('dm', '423e4567-e89b-12d3-a456-426614174000', type: 'dm'),
      ],
    );

    expect(records, isEmpty);
    expect(gateway.filters, isEmpty);
  });

  test(
    'rejects an invalid relay record instead of showing an empty work list',
    () async {
      final valid = _signedWork(_workOne, _channelOne, _member);
      final invalid = NostrEvent(
        id: valid.id,
        pubkey: valid.pubkey,
        createdAt: valid.createdAt,
        kind: valid.kind,
        tags: valid.tags,
        content: '{"title":"tampered"}',
        sig: valid.sig,
      );

      await expectLater(
        CompanyWorkRepository(_WorkGateway([invalid])).loadCurrent(
          memberPubkey: _member,
          relaySelf: valid.pubkey,
          channels: [_channel('sales', _channelOne)],
        ),
        throwsFormatException,
      );
    },
  );
}

class _WorkGateway implements CompanyWorkRecordGateway {
  _WorkGateway(this.events);

  final List<NostrEvent> events;
  final filters = <NostrFilter>[];

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    filters.add(filter);
    final ids = filter.tags['#h']?.toSet() ?? const <String>{};
    return events
        .where((event) => ids.contains(event.getTagValue('h')))
        .toList();
  }
}

Channel _channel(
  String name,
  String id, {
  String type = 'stream',
  bool isMember = true,
  bool archived = false,
}) => Channel(
  id: id,
  name: name,
  channelType: type,
  visibility: 'private',
  description: '',
  createdBy: _member,
  createdAt: DateTime.utc(2026),
  memberCount: 1,
  isMember: isMember,
  archivedAt: archived ? DateTime.utc(2026, 9) : null,
);

NostrEvent _signedWork(
  String workItemId,
  String channelId,
  String assignedPubkey, {
  String title = 'Work item',
  String status = 'active',
  int createdAt = 1,
}) {
  final content = jsonEncode({
    'schemaVersion': companyWorkSchemaVersion,
    'workItemId': workItemId,
    'title': title,
    'status': status,
    'assignedPubkeys': [assignedPubkey],
    'approverPubkeys': <String>[],
    'deliverables': <Object>[],
    'requesterPubkey': assignedPubkey,
    'doneCondition': 'The owner approves the work.',
    'sourceActionEventId': List.filled(64, 'f').join(),
  });
  return NostrEvent.fromJson(
    nostr.Event.from(
      kind: EventKind.workItemHead,
      content: content,
      tags: [
        ['h', channelId],
        ['d', 'company:work:$workItemId'],
      ],
      secretKey: _relaySecret,
      createdAt: createdAt,
      verify: false,
    ).toMap(),
  );
}
