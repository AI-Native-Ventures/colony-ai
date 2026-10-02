import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../relay/relay.dart';
import 'workflow_records.dart';

final _workflowPubkeyPattern = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);

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

@immutable
class WorkflowPickerQuery {
  const WorkflowPickerQuery({
    required this.channelIds,
    required this.ownerPubkey,
  });

  final List<String> channelIds;
  final String? ownerPubkey;

  @override
  bool operator ==(Object other) =>
      other is WorkflowPickerQuery &&
      listEquals(other.channelIds, channelIds) &&
      other.ownerPubkey == ownerPubkey;

  @override
  int get hashCode => Object.hash(Object.hashAll(channelIds), ownerPubkey);
}

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

  /// Loads active definitions plus this member's channel-scoped drafts.
  Future<List<WorkflowRecord>> loadPickerItems({
    required List<String> channelIds,
    required String? ownerPubkey,
  }) async {
    final channels = _normalizeIds(channelIds);
    if (channels.isEmpty) return const [];
    final activeEvents = <NostrEvent>[];
    for (final chunk in _chunks(channels, 128)) {
      final events = await gateway.fetch(
        NostrFilter(
          kinds: const [EventKind.workflowDefinition],
          tags: {'#h': chunk},
          limit: workflowQueryLimit,
        ),
      );
      _checkQueryBound(events, 'workflow definitions');
      activeEvents.addAll(events);
    }
    final active = <WorkflowRecord>[];
    for (final event in activeEvents) {
      if (!_hasChannel(event, channels)) continue;
      final record = parseWorkflowDefinitionEvent(event);
      if (record == null) {
        throw const FormatException(
          'A visible workflow uses a definition this mobile version cannot read.',
        );
      }
      active.add(record);
    }

    final drafts = <WorkflowRecord>[];
    if (ownerPubkey != null && _workflowPubkeyPattern.hasMatch(ownerPubkey)) {
      final draftEvents = <NostrEvent>[];
      for (final chunk in _chunks(channels, 128)) {
        final events = await gateway.fetch(
          NostrFilter(
            kinds: const [EventKind.workflowDraft],
            authors: [ownerPubkey.toLowerCase()],
            tags: {'#h': chunk},
            limit: workflowQueryLimit,
          ),
        );
        _checkQueryBound(events, 'workflow drafts');
        draftEvents.addAll(events);
      }
      for (final event in draftEvents) {
        if (!_hasChannel(event, channels)) continue;
        final record = parseWorkflowDraftEvent(event);
        if (record == null || record.ownerPubkey != ownerPubkey.toLowerCase()) {
          throw const FormatException(
            'The relay returned an invalid signed workflow draft.',
          );
        }
        drafts.add(record);
      }
    }

    final statuses = await _loadStatuses(active);
    final activeWithStatus = [
      for (final record in active) _applyLatestStatus(record, statuses),
    ];
    final combined = [...activeWithStatus, ...drafts];
    combined.sort((left, right) {
      final nameOrder = left.name.toLowerCase().compareTo(
        right.name.toLowerCase(),
      );
      if (nameOrder != 0) return nameOrder;
      final draftOrder = left.isDraft == right.isDraft
          ? 0
          : left.isDraft
          ? -1
          : 1;
      if (draftOrder != 0) return draftOrder;
      return _newestFirst(left.event, right.event);
    });
    return List.unmodifiable(combined);
  }

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

  /// Saves one owner-authored draft without changing the active definition.
  Future<NostrEvent> saveDraft({
    required String workflowId,
    required String channelId,
    required String ownerPubkey,
    required String name,
    required String? description,
    required Map<String, Object?>? triggerWire,
    required List<WorkflowStepRecord> steps,
    required WorkflowRecord? expectedDraft,
  }) async {
    final id = workflowId.toLowerCase();
    final channel = channelId.toLowerCase();
    final owner = ownerPubkey.toLowerCase();
    if (!isWorkflowId(id) ||
        !isWorkflowId(channel) ||
        !_workflowPubkeyPattern.hasMatch(owner)) {
      throw const FormatException(
        'The workflow or channel identity is invalid.',
      );
    }
    final currentDraft = await loadDraft(
      workflowId: id,
      channelId: channel,
      ownerPubkey: owner,
    );
    if (currentDraft?.event.id != expectedDraft?.event.id) {
      throw const WorkflowChangedException();
    }
    final content = workflowDefinitionJson(
      name: name,
      description: description,
      triggerWire: triggerWire,
      steps: steps,
      allowEmptySteps: true,
    );
    return gateway.publish(
      kind: EventKind.workflowDraft,
      content: content,
      tags: [
        ['d', id],
        ['h', channel],
        if (currentDraft != null) ['expected-revision', currentDraft.event.id],
      ],
    );
  }

  /// Reads the caller's latest draft for one workflow coordinate.
  Future<WorkflowRecord?> loadDraft({
    required String workflowId,
    required String channelId,
    required String ownerPubkey,
  }) async {
    final id = workflowId.toLowerCase();
    final channel = channelId.toLowerCase();
    final owner = ownerPubkey.toLowerCase();
    if (!isWorkflowId(id) ||
        !isWorkflowId(channel) ||
        !_workflowPubkeyPattern.hasMatch(owner)) {
      throw const FormatException('The workflow identity is invalid.');
    }
    final events = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.workflowDraft],
        authors: [owner],
        tags: {
          '#d': [id],
          '#h': [channel],
        },
        limit: workflowQueryLimit,
      ),
    );
    _checkQueryBound(events, 'workflow draft history');
    final records = <WorkflowRecord>[];
    for (final event in events) {
      if (!_tagEquals(event, 'd', id) ||
          !_tagEquals(event, 'h', channel) ||
          event.pubkey.toLowerCase() != owner) {
        continue;
      }
      final record = parseWorkflowDraftEvent(event);
      if (record == null) {
        throw const FormatException(
          'The relay returned an invalid signed workflow draft.',
        );
      }
      records.add(record);
    }
    records.sort((left, right) => _newestFirst(left.event, right.event));
    return records.firstOrNull;
  }

  /// Publishes a saved draft with the server's active revision fence.
  Future<NostrEvent> publishDraft({
    required WorkflowRecord expectedDraft,
    required WorkflowRecord? expectedActive,
    required String ownerPubkey,
  }) async {
    if (!expectedDraft.isDraft ||
        expectedDraft.ownerPubkey != ownerPubkey.toLowerCase() ||
        expectedDraft.steps.isEmpty) {
      throw const FormatException(
        'Add a complete step before publishing this workflow.',
      );
    }
    final currentDraft = await loadDraft(
      workflowId: expectedDraft.workflowId,
      channelId: expectedDraft.channelId,
      ownerPubkey: ownerPubkey,
    );
    if (currentDraft?.event.id != expectedDraft.event.id) {
      throw const WorkflowChangedException();
    }
    final currentActive = await load(
      workflowId: expectedDraft.workflowId,
      channelIds: [expectedDraft.channelId],
    );
    if (currentActive?.event.id != expectedActive?.event.id ||
        (currentActive != null &&
            (currentActive.ownerPubkey != ownerPubkey.toLowerCase() ||
                currentActive.channelId != expectedDraft.channelId))) {
      throw const WorkflowChangedException();
    }
    return gateway.publish(
      kind: EventKind.workflowDefinition,
      content: expectedDraft.event.content,
      tags: [
        ['d', expectedDraft.workflowId],
        ['h', expectedDraft.channelId],
        if (currentActive != null)
          ['expected-revision', currentActive.event.id],
      ],
    );
  }

  /// Starts a real workflow run and returns the server-created run id.
  Future<String> trigger(String workflowId) async {
    final id = workflowId.toLowerCase();
    if (!isWorkflowId(id)) {
      throw ArgumentError.value(workflowId, 'workflowId', 'Expected a UUID');
    }
    final acknowledgement = await gateway.publish(
      kind: EventKind.workflowTrigger,
      content: '',
      tags: [
        ['d', id],
      ],
    );
    final raw = acknowledgement.content.startsWith('response:')
        ? acknowledgement.content.substring('response:'.length)
        : acknowledgement.content;
    final body = jsonDecode(raw);
    if (body is! Map<String, dynamic> ||
        body['run_id'] is! String ||
        !isWorkflowId(body['run_id'] as String)) {
      throw const FormatException(
        'The relay acknowledged the run without a valid run id.',
      );
    }
    return (body['run_id'] as String).toLowerCase();
  }

  Future<List<WorkflowStatusRecord>> _loadStatuses(
    List<WorkflowRecord> records,
  ) async {
    if (records.isEmpty) return const [];
    final statuses = <WorkflowStatusRecord>[];
    final ids = records.map((record) => record.workflowId).toSet().toList();
    final channelIds = records
        .map((record) => record.channelId)
        .toSet()
        .toList();
    for (final idChunk in _chunks(ids, 128)) {
      for (final channelChunk in _chunks(channelIds, 128)) {
        final events = await gateway.fetch(
          NostrFilter(
            kinds: const [EventKind.workflowStatus],
            tags: {'#workflow': idChunk, '#h': channelChunk},
            limit: workflowQueryLimit,
          ),
        );
        _checkQueryBound(events, 'workflow status history');
        for (final event in events) {
          final status = parseWorkflowStatusEvent(event);
          if (status == null) {
            throw const FormatException(
              'The relay returned an invalid signed workflow status.',
            );
          }
          statuses.add(status);
        }
      }
    }
    statuses.sort((left, right) => _newestFirst(left.event, right.event));
    return statuses;
  }

  WorkflowRecord _applyLatestStatus(
    WorkflowRecord record,
    List<WorkflowStatusRecord> statuses,
  ) {
    final latest = statuses
        .where(
          (status) =>
              status.workflowId == record.workflowId &&
              status.channelId == record.channelId,
        )
        .firstOrNull;
    return latest == null
        ? record
        : record.withStatus(latest.status, latest.event);
  }
}

/// Encodes the supported editor fields as JSON, which the workflow parser also
/// accepts as YAML. The relay remains responsible for validating the schema.
String workflowDefinitionJson({
  required String name,
  required String? description,
  required Map<String, Object?>? triggerWire,
  required List<WorkflowStepRecord> steps,
  bool allowEmptySteps = false,
}) {
  final cleanName = name.trim();
  if (cleanName.isEmpty) {
    throw const FormatException('Add a workflow name before saving.');
  }
  if (steps.isEmpty && !allowEmptySteps) {
    throw const FormatException('Add at least one step before publishing.');
  }
  final triggerValue = triggerWire;
  if (triggerValue == null ||
      !triggerValue.keys.every((key) => key == 'on' || key == 'cron') ||
      !((triggerValue['on'] == 'manual' && triggerValue.length == 1) ||
          (triggerValue['on'] == 'schedule' &&
              triggerValue['cron'] is String &&
              triggerValue.length == 2))) {
    throw const FormatException('The workflow schedule is unsupported.');
  }
  final encodedSteps = <Map<String, Object?>>[];
  for (final step in steps) {
    final title = step.title.trim();
    if (step.kind == WorkflowStepKind.agent) {
      final assignee = step.assigneePubkey;
      if (assignee == null || !_workflowPubkeyPattern.hasMatch(assignee)) {
        throw const FormatException('Choose a real agent for every step.');
      }
      if (step.instruction.trim().isEmpty) {
        throw const FormatException('Describe what the agent should do.');
      }
      final expectedResult = step.expectedResult?.trim();
      if (expectedResult == null || expectedResult.isEmpty) {
        throw const FormatException('Choose when the agent step is complete.');
      }
      encodedSteps.add({
        'id': step.id,
        'name': title.isEmpty ? null : title,
        'action': 'ask_agent',
        'agent_pubkey': assignee.toLowerCase(),
        'instruction': step.instruction.trim(),
        'expected_result': expectedResult,
      });
    } else {
      final reviewer = step.reviewerPubkey ?? step.reviewerScope;
      if (reviewer == null || reviewer.trim().isEmpty) {
        throw const FormatException('Choose a real reviewer for every step.');
      }
      if (step.instruction.trim().isEmpty) {
        throw const FormatException(
          'Describe what the reviewer should decide.',
        );
      }
      encodedSteps.add({
        'id': step.id,
        'name': title.isEmpty ? null : title,
        'action': 'request_approval',
        'from': reviewer,
        'message': step.instruction.trim(),
      });
    }
  }
  return jsonEncode({
    'name': cleanName,
    if (description?.trim().isNotEmpty == true)
      'description': description!.trim(),
    'enabled': true,
    'trigger': triggerValue,
    'steps': encodedSteps,
  });
}

/// Loads one workflow record while respecting the active relay configuration.
final workflowRecordProvider = FutureProvider.autoDispose
    .family<WorkflowRecord?, WorkflowQuery>((ref, query) async {
      ref.watch(relayConfigProvider);
      return ref
          .watch(workflowRepositoryProvider)
          .load(workflowId: query.workflowId, channelIds: query.channelIds);
    });

/// Loads the real active workflows visible in the member's channels.
final workflowPickerProvider = FutureProvider.autoDispose
    .family<List<WorkflowRecord>, WorkflowPickerQuery>((ref, query) async {
      ref.watch(relayConfigProvider);
      return ref
          .watch(workflowRepositoryProvider)
          .loadPickerItems(
            channelIds: query.channelIds,
            ownerPubkey: query.ownerPubkey,
          );
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

List<String> _normalizeIds(List<String> values) =>
    values
        .map((value) => value.toLowerCase())
        .where(isWorkflowId)
        .toSet()
        .toList()
      ..sort();

Iterable<List<T>> _chunks<T>(List<T> values, int size) sync* {
  for (var start = 0; start < values.length; start += size) {
    final end = (start + size).clamp(0, values.length);
    yield values.sublist(start, end);
  }
}

int _newestFirst(NostrEvent left, NostrEvent right) {
  final timestampOrder = right.createdAt.compareTo(left.createdAt);
  return timestampOrder != 0 ? timestampOrder : right.id.compareTo(left.id);
}
