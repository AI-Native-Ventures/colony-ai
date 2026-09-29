import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../goals/goal_repository.dart';
import '../../relay/relay.dart';
import 'member_position_records.dart';

abstract interface class MemberPositionGateway {
  Future<List<NostrEvent>> fetch(NostrFilter filter);

  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  });
}

class RelayMemberPositionGateway implements MemberPositionGateway {
  const RelayMemberPositionGateway({required this.session, required this.nsec});

  final RelaySessionNotifier session;
  final String? nsec;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) =>
      session.fetchHistory(filter, timeout: const Duration(seconds: 8));

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) => SignedEventRelay(
    session: session,
    nsec: nsec,
  ).submit(kind: kind, content: content, tags: tags);
}

final memberPositionGatewayProvider = Provider<MemberPositionGateway>((ref) {
  return RelayMemberPositionGateway(
    session: ref.read(relaySessionProvider.notifier),
    nsec: ref.watch(relayConfigProvider).nsec,
  );
});

final memberPositionRepositoryProvider = Provider<MemberPositionRepository>(
  (ref) => MemberPositionRepository(ref.watch(memberPositionGatewayProvider)),
);

/// Reads and writes the relay-signed current member-position heads.
class MemberPositionRepository {
  const MemberPositionRepository(this.gateway);

  final MemberPositionGateway gateway;

  Future<List<MemberPositionHeadRecord>> loadHeads({
    required String? relaySelf,
  }) async {
    if (relaySelf == null || !_isHex64(relaySelf)) {
      throw StateError('This relay does not advertise a signing identity.');
    }
    final events = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.memberPositionHead],
        authors: [relaySelf.toLowerCase()],
        limit: memberPositionHeadQueryLimit + 1,
      ),
    );
    if (events.length > memberPositionHeadQueryLimit) {
      throw StateError('The company team exceeds the supported member limit.');
    }
    final records = <MemberPositionHeadRecord>[];
    final seen = <String>{};
    for (final event in events) {
      final record = parseMemberPositionHeadEvent(event, relaySelf);
      if (record == null) {
        throw const FormatException(
          'The relay returned an invalid signed member position.',
        );
      }
      if (!seen.add(record.dTag)) {
        throw const FormatException(
          'The relay returned more than one current member position.',
        );
      }
      records.add(record);
    }
    records.sort(
      (left, right) => left.head.pubkey.compareTo(right.head.pubkey),
    );
    return records;
  }

  Future<NostrEvent> submit(MemberPositionAction action) {
    final validationError = validateMemberPositionAction(action);
    if (validationError != null) throw ArgumentError(validationError);
    return gateway.publish(
      kind: EventKind.memberPositionAction,
      content: jsonEncode(action.toJson()),
      tags: [
        ['d', memberPositionDTag(action.pubkey)],
      ],
    );
  }
}

final memberPositionHeadsProvider =
    FutureProvider.autoDispose<List<MemberPositionHeadRecord>>((ref) async {
      ref.watch(relayConfigProvider);
      final relaySelf = await ref.watch(goalRelaySelfProvider.future);
      return ref
          .watch(memberPositionRepositoryProvider)
          .loadHeads(relaySelf: relaySelf);
    });

bool _isHex64(String value) => RegExp(r'^[0-9a-f]{64}$').hasMatch(value);

@visibleForTesting
Future<List<MemberPositionHeadRecord>> loadVerifiedMemberPositionHeads(
  MemberPositionGateway gateway, {
  required String? relaySelf,
}) => MemberPositionRepository(gateway).loadHeads(relaySelf: relaySelf);
