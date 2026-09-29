import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../relay/relay.dart';
import 'workflow_records.dart';

/// Relay boundary for workflow definitions, lifecycle records, and commands.
abstract interface class WorkflowRecordGateway {
  /// Fetches events matching one relay filter.
  Future<List<NostrEvent>> fetch(NostrFilter filter);

  /// Publishes a signed workflow event and returns the acknowledged event.
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  });
}

class RelayWorkflowRecordGateway implements WorkflowRecordGateway {
  const RelayWorkflowRecordGateway({required this.session, required this.nsec});

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

/// Provides the live relay gateway used by workflow records.
final workflowRecordGatewayProvider = Provider<WorkflowRecordGateway>((ref) {
  return RelayWorkflowRecordGateway(
    session: ref.read(relaySessionProvider.notifier),
    nsec: ref.watch(relayConfigProvider).nsec,
  );
});

/// Provides the repository for loading and changing workflow lifecycle state.
final workflowRepositoryProvider = Provider<WorkflowRepository>(
  (ref) => WorkflowRepository(ref.watch(workflowRecordGatewayProvider)),
);

/// Query key for one workflow scoped to the member channels of this user.
@immutable
class WorkflowQuery {
  const WorkflowQuery({required this.workflowId, required this.channelIds});

  final String workflowId;
  final List<String> channelIds;

  @override
  bool operator ==(Object other) =>
      other is WorkflowQuery &&
      other.workflowId == workflowId &&
      listEquals(other.channelIds, channelIds);

  @override
  int get hashCode => Object.hash(workflowId, Object.hashAll(channelIds));
}

/// Reads and updates relay-backed workflow records.
class WorkflowRepository {
  const WorkflowRepository(this.gateway);

  final WorkflowRecordGateway gateway;

  /// Loads the newest valid definition and status visible in [channelIds].
  Future<WorkflowRecord?> load({
    required String workflowId,
    required List<String> channelIds,
  }) async {
    final id = workflowId.toLowerCase();
    if (!isWorkflowId(id)) {
      throw ArgumentError.value(workflowId, 'workflowId', 'Expected a UUID');
    }
    final channels =
        channelIds
            .map((channelId) => channelId.toLowerCase())
            .where(isWorkflowId)
            .toSet()
            .toList()
          ..sort();
    if (channels.isEmpty) return null;

    final definitionFuture = gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.workflowDefinition],
        tags: {
          '#d': [id],
          '#h': channels,
        },
        limit: workflowQueryLimit,
      ),
    );
    final statusFuture = gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.workflowStatus],
        tags: {
          '#workflow': [id],
          '#h': channels,
        },
        limit: workflowQueryLimit,
      ),
    );
    final results = await Future.wait([definitionFuture, statusFuture]);
    final definitions = results[0];
    final statusEvents = results[1];
    _checkQueryBound(definitions, 'workflow definitions');
    _checkQueryBound(statusEvents, 'workflow status history');

    final records = <WorkflowRecord>[];
    for (final event in definitions) {
      if (!_tagEquals(event, 'd', id) || !_hasChannel(event, channels)) {
        continue;
      }
      final record = parseWorkflowDefinitionEvent(event);
      if (record == null) {
        throw const FormatException(
          'The relay returned an invalid signed workflow definition.',
        );
      }
      records.add(record);
    }
    if (records.isEmpty) return null;
    records.sort((left, right) => _newestFirst(left.event, right.event));
    final selected = records.first;
    if (records
        .skip(1)
        .any(
          (record) =>
              record.ownerPubkey != selected.ownerPubkey ||
              record.channelId != selected.channelId,
        )) {
      throw const FormatException(
        'The workflow identifier resolves to more than one record.',
      );
    }

    final statuses = <WorkflowStatusRecord>[];
    for (final event in statusEvents) {
      if (!_tagEquals(event, 'workflow', id) ||
          !_tagEquals(event, 'h', selected.channelId)) {
        continue;
      }
      final status = parseWorkflowStatusEvent(event);
      if (status == null) {
        throw const FormatException(
          'The relay returned an invalid signed workflow status.',
        );
      }
      statuses.add(status);
    }
    statuses.sort((left, right) => _newestFirst(left.event, right.event));
    final latestStatus = statuses.firstOrNull;
    return latestStatus == null
        ? selected
        : selected.withStatus(latestStatus.status, latestStatus.event);
  }

  /// Changes status only if the workflow still matches [expectedRecord].
  Future<NostrEvent> setStatus({
    required WorkflowRecord expectedRecord,
    required WorkflowStatus status,
    required List<String> channelIds,
  }) async {
    final current = await load(
      workflowId: expectedRecord.workflowId,
      channelIds: channelIds,
    );
    if (current == null ||
        current.event.id != expectedRecord.event.id ||
        current.status != expectedRecord.status ||
        current.statusEvent?.id != expectedRecord.statusEvent?.id) {
      throw const WorkflowChangedException();
    }
    return gateway.publish(
      kind: EventKind.workflowStatus,
      content: jsonEncode({'status': status.wireValue}),
      tags: [
        ['workflow', current.workflowId],
        ['h', current.channelId],
      ],
    );
  }
}

/// Loads one workflow record while respecting the active relay configuration.
final workflowRecordProvider = FutureProvider.autoDispose
    .family<WorkflowRecord?, WorkflowQuery>((ref, query) async {
      ref.watch(relayConfigProvider);
      return ref
          .watch(workflowRepositoryProvider)
          .load(workflowId: query.workflowId, channelIds: query.channelIds);
    });

/// A status write was based on a stale definition or lifecycle record.
class WorkflowChangedException implements Exception {
  const WorkflowChangedException();

  @override
  String toString() => 'The workflow changed. Reload it before trying again.';
}

void _checkQueryBound(List<NostrEvent> events, String label) {
  if (events.length >= workflowQueryLimit) {
    throw StateError('The $label exceed the supported read limit.');
  }
}

bool _tagEquals(NostrEvent event, String name, String value) => event.tags.any(
  (tag) => tag.length == 2 && tag[0] == name && tag[1].toLowerCase() == value,
);

bool _hasChannel(NostrEvent event, List<String> channels) => event.tags.any(
  (tag) =>
      tag.length == 2 &&
      tag[0] == 'h' &&
      channels.contains(tag[1].toLowerCase()),
);

int _newestFirst(NostrEvent left, NostrEvent right) {
  final timestampOrder = right.createdAt.compareTo(left.createdAt);
  return timestampOrder != 0 ? timestampOrder : right.id.compareTo(left.id);
}
