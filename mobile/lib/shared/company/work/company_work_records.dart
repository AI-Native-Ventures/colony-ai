import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:nostr/nostr.dart' as nostr;
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../../features/channels/channel.dart';
import '../../../features/channels/channels_provider.dart';
import '../../relay/relay.dart';
import '../goals/goal_repository.dart';

/// Maximum work heads returned across one scoped relay read.
const companyWorkHeadQueryLimit = 10000;

/// Version accepted for relay-signed company work heads.
const companyWorkSchemaVersion = 1;

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _hex64Pattern = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);
const _activeWorkStatuses = {'active', 'paused', 'blocked', 'done_unverified'};

/// A verified relay-signed work commitment assigned to one member.
class CompanyWorkHeadRecord {
  const CompanyWorkHeadRecord({
    required this.workItemId,
    required this.title,
    required this.status,
    required this.assignedPubkeys,
    required this.channelId,
    required this.channelName,
    required this.event,
  });

  /// Stable work-item identifier.
  final String workItemId;

  /// Current work title.
  final String title;

  /// Current lifecycle status.
  final String status;

  /// Member pubkeys assigned to this work item.
  final List<String> assignedPubkeys;

  /// Channel containing the work item.
  final String channelId;

  /// Display name of [channelId].
  final String channelName;

  /// Relay-signed head event.
  final NostrEvent event;
}

/// Loads current shared work assigned to [memberPubkey] from channels the
/// current identity can read.
final companyMemberWorkProvider = FutureProvider.autoDispose
    .family<List<CompanyWorkHeadRecord>, String>((ref, memberPubkey) async {
      ref.watch(relayConfigProvider);
      final channels = await ref.watch(channelsProvider.future);
      final relaySelf = await ref.watch(goalRelaySelfProvider.future);
      return CompanyWorkRepository(
        ref.watch(companyWorkRecordGatewayProvider),
      ).loadCurrent(
        memberPubkey: memberPubkey,
        relaySelf: relaySelf,
        channels: channels,
      );
    });

/// Fetches one bounded relay query used by the company work repository.
abstract interface class CompanyWorkRecordGateway {
  /// Returns matching events from the active relay.
  Future<List<NostrEvent>> fetch(NostrFilter filter);
}

/// Reads company work heads from the active relay session.
class RelayCompanyWorkRecordGateway implements CompanyWorkRecordGateway {
  const RelayCompanyWorkRecordGateway(this.session);

  final RelaySessionNotifier session;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) =>
      session.fetchHistory(filter, timeout: const Duration(seconds: 8));
}

/// Provides the active relay gateway for read-only company work records.
final companyWorkRecordGatewayProvider = Provider<CompanyWorkRecordGateway>(
  (ref) =>
      RelayCompanyWorkRecordGateway(ref.read(relaySessionProvider.notifier)),
);

/// Relay boundary for reading signed company work heads.
class CompanyWorkRepository {
  const CompanyWorkRepository(this.gateway);

  final CompanyWorkRecordGateway gateway;

  /// Returns current assignments from joined, unarchived stream channels.
  Future<List<CompanyWorkHeadRecord>> loadCurrent({
    required String memberPubkey,
    required String? relaySelf,
    required List<Channel> channels,
  }) async {
    final normalizedMember = memberPubkey.trim().toLowerCase();
    final normalizedRelay = relaySelf?.trim().toLowerCase();
    if (!_hex64Pattern.hasMatch(normalizedMember)) {
      throw const FormatException('A member key is invalid.');
    }
    if (normalizedRelay == null || !_hex64Pattern.hasMatch(normalizedRelay)) {
      throw StateError('This relay does not advertise a signing identity.');
    }

    final visibleChannels = channels
        .where(
          (channel) =>
              channel.channelType == 'stream' &&
              channel.isMember &&
              !channel.isArchived,
        )
        .toList(growable: false);
    final channelById = {
      for (final channel in visibleChannels) channel.id.toLowerCase(): channel,
    };
    final channelIds = channelById.keys.toList()..sort();
    if (channelIds.isEmpty) return const [];
    if (channelIds.length > 4096) {
      throw StateError('Too many channels to load company work.');
    }

    final recordsById = <String, CompanyWorkHeadRecord>{};
    final seenWorkItemIds = <String>{};
    var totalEvents = 0;
    for (
      var offset = 0;
      offset < channelIds.length;
      offset += kMaxExplicitChannelValues
    ) {
      final chunk = channelIds
          .skip(offset)
          .take(kMaxExplicitChannelValues)
          .toList(growable: false);
      final events = await gateway.fetch(
        NostrFilter(
          kinds: const [EventKind.workItemHead],
          authors: [normalizedRelay],
          tags: {'#h': chunk},
          limit: companyWorkHeadQueryLimit + 1,
        ),
      );
      if (events.length > companyWorkHeadQueryLimit) {
        throw StateError(
          'The company work list exceeds the supported read limit.',
        );
      }
      totalEvents += events.length;
      if (totalEvents > companyWorkHeadQueryLimit) {
        throw StateError(
          'The company work list exceeds the supported read limit.',
        );
      }
      for (final event in events) {
        final dTag = event.getTagValue('d') ?? '';
        if (!dTag.startsWith('company:work:')) continue;
        final record = parseCompanyWorkHeadEvent(event, normalizedRelay);
        if (record == null) {
          throw const FormatException(
            'The relay returned an invalid signed company work item.',
          );
        }
        if (!channelById.containsKey(record.channelId)) {
          throw const FormatException(
            'The relay returned company work outside its channel scope.',
          );
        }
        if (!seenWorkItemIds.add(record.workItemId)) {
          throw const FormatException(
            'The relay returned duplicate company work item heads.',
          );
        }
        if (!record.assignedPubkeys.contains(normalizedMember)) continue;
        if (!_activeWorkStatuses.contains(record.status)) continue;
        recordsById[record.workItemId] = CompanyWorkHeadRecord(
          workItemId: record.workItemId,
          title: record.title,
          status: record.status,
          assignedPubkeys: record.assignedPubkeys,
          channelId: record.channelId,
          channelName: channelById[record.channelId]!.name,
          event: event,
        );
      }
    }

    final records = recordsById.values.toList()
      ..sort((left, right) {
        final byTime = right.event.createdAt.compareTo(left.event.createdAt);
        return byTime != 0 ? byTime : right.event.id.compareTo(left.event.id);
      });
    return List.unmodifiable(records);
  }
}

/// Parses a current work head using the same event and payload contract as the
/// desktop company work reader.
@visibleForTesting
CompanyWorkHeadRecord? parseCompanyWorkHeadEvent(
  NostrEvent event,
  String relaySelf,
) {
  try {
    if (event.kind != EventKind.workItemHead ||
        !_hex64Pattern.hasMatch(relaySelf) ||
        event.pubkey.toLowerCase() != relaySelf.toLowerCase()) {
      return null;
    }
    final verified = nostr.Event.fromJson(jsonEncode(event.toJson()));
    if (verified.id != event.id ||
        verified.pubkey.toLowerCase() != event.pubkey.toLowerCase()) {
      return null;
    }
  } on Object {
    return null;
  }

  if (event.tags.length != 2 ||
      event.tags.any(
        (tag) => tag.length != 2 || (tag.first != 'h' && tag.first != 'd'),
      )) {
    return null;
  }
  final channelTags = event.tags.where((tag) => tag.first == 'h').toList();
  final dTags = event.tags.where((tag) => tag.first == 'd').toList();
  if (channelTags.length != 1 || dTags.length != 1) return null;
  final channelId = channelTags.single[1].toLowerCase();
  final dTag = dTags.single[1];
  final match = RegExp(
    r'^company:work:([0-9a-f-]{36})$',
    caseSensitive: false,
  ).firstMatch(dTag);
  if (!_uuidPattern.hasMatch(channelId) ||
      match == null ||
      !_uuidPattern.hasMatch(match[1]!)) {
    return null;
  }

  final Map<String, dynamic> head;
  try {
    final decoded = jsonDecode(event.content);
    if (decoded is! Map<String, dynamic>) return null;
    head = decoded;
  } on FormatException {
    return null;
  }
  const keys = {
    'schemaVersion',
    'workItemId',
    'title',
    'status',
    'assignedPubkeys',
    'approverPubkeys',
    'deliverables',
    'requesterPubkey',
    'doneCondition',
    'goalId',
    'sourceEventId',
    'threadRootEventId',
    'evidence',
    'statusReason',
    'verification',
    'acceptedAt',
    'dueAt',
    'sourceActionEventId',
  };
  if (head.keys.any((key) => !keys.contains(key)) ||
      head['schemaVersion'] != companyWorkSchemaVersion ||
      head['workItemId'] is! String ||
      (head['workItemId'] as String).toLowerCase() != match[1]!.toLowerCase() ||
      head['title'] is! String ||
      (head['title'] as String).trim().isEmpty ||
      head['status'] is! String ||
      !{
        'active',
        'paused',
        'blocked',
        'done_unverified',
        'done_verified',
        'archived',
      }.contains(head['status']) ||
      head['assignedPubkeys'] is! List ||
      (head['assignedPubkeys'] as List).length != 1 ||
      !(head['assignedPubkeys'] as List).every(
        (value) => value is String && _hex64Pattern.hasMatch(value),
      ) ||
      head['approverPubkeys'] is! List ||
      !(head['approverPubkeys'] as List).every(
        (value) => value is String && _hex64Pattern.hasMatch(value),
      ) ||
      head['deliverables'] is! List ||
      head['requesterPubkey'] is! String ||
      !_hex64Pattern.hasMatch(head['requesterPubkey'] as String) ||
      head['doneCondition'] is! String ||
      (head['doneCondition'] as String).trim().isEmpty ||
      head['sourceActionEventId'] is! String ||
      !_hex64Pattern.hasMatch(head['sourceActionEventId'] as String)) {
    return null;
  }
  final workItemId = (head['workItemId'] as String).toLowerCase();
  return CompanyWorkHeadRecord(
    workItemId: workItemId,
    title: head['title'] as String,
    status: head['status'] as String,
    assignedPubkeys: [
      for (final pubkey in head['assignedPubkeys'] as List)
        (pubkey as String).toLowerCase(),
    ],
    channelId: channelId,
    channelName: '',
    event: event,
  );
}
