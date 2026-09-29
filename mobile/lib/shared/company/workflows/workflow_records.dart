import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:yaml/yaml.dart';

import '../../relay/nostr_models.dart';

/// Maximum number of matching events returned for one workflow query.
const workflowQueryLimit = 1000;

/// Maximum UTF-8 size accepted for a workflow definition.
const maxWorkflowDefinitionBytes = 500000;

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _hex64Pattern = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);

/// Lifecycle states currently supported by the relay workflow command.
enum WorkflowStatus { active, paused }

extension WorkflowStatusWire on WorkflowStatus {
  String get wireValue => switch (this) {
    WorkflowStatus.active => 'active',
    WorkflowStatus.paused => 'paused',
  };
}

/// Step types that the mobile workflow detail can display.
enum WorkflowStepKind { agent, approval }

/// One supported step parsed from a signed workflow definition.
@immutable
class WorkflowStepRecord {
  const WorkflowStepRecord({
    required this.id,
    required this.kind,
    required this.title,
    required this.instruction,
    this.assigneePubkey,
    this.reviewerPubkey,
    this.reviewerScope,
  });

  final String id;
  final WorkflowStepKind kind;
  final String title;
  final String instruction;
  final String? assigneePubkey;
  final String? reviewerPubkey;
  final String? reviewerScope;
}

/// The supported schedule information for a workflow.
@immutable
class WorkflowTriggerRecord {
  const WorkflowTriggerRecord({
    required this.frequency,
    this.dayOfWeek,
    this.hour,
    this.minute,
  });

  final String frequency;
  final int? dayOfWeek;
  final int? hour;
  final int? minute;

  bool get isScheduled => frequency == 'weekly' || frequency == 'daily';
}

/// A verified workflow definition combined with its latest known status.
@immutable
class WorkflowRecord {
  const WorkflowRecord({
    required this.event,
    required this.workflowId,
    required this.channelId,
    required this.name,
    required this.description,
    required this.trigger,
    required this.steps,
    required this.status,
    this.statusEvent,
  });

  final NostrEvent event;
  final String workflowId;
  final String channelId;
  final String name;
  final String? description;
  final WorkflowTriggerRecord trigger;
  final List<WorkflowStepRecord> steps;
  final WorkflowStatus status;
  final NostrEvent? statusEvent;

  String get ownerPubkey => event.pubkey.toLowerCase();

  WorkflowRecord withStatus(WorkflowStatus next, NostrEvent? source) =>
      WorkflowRecord(
        event: event,
        workflowId: workflowId,
        channelId: channelId,
        name: name,
        description: description,
        trigger: trigger,
        steps: steps,
        status: next,
        statusEvent: source,
      );
}

/// A verified lifecycle status event for a workflow.
@immutable
class WorkflowStatusRecord {
  const WorkflowStatusRecord({
    required this.event,
    required this.workflowId,
    required this.channelId,
    required this.status,
  });

  final NostrEvent event;
  final String workflowId;
  final String channelId;
  final WorkflowStatus status;
}

/// Parses and verifies a workflow definition for the mobile detail.
WorkflowRecord? parseWorkflowDefinitionEvent(NostrEvent event) {
  if (event.kind != EventKind.workflowDefinition ||
      !_hasValidSignature(event)) {
    return null;
  }
  final workflowId = _singleTagValue(event, 'd');
  final channelId = _singleTagValue(event, 'h');
  if (workflowId == null ||
      !_uuidPattern.hasMatch(workflowId) ||
      channelId == null ||
      !_uuidPattern.hasMatch(channelId) ||
      !_hasAllowedDefinitionTags(event)) {
    return null;
  }
  if (utf8.encode(event.content).length > maxWorkflowDefinitionBytes) {
    return null;
  }

  final definition = _decodeYamlObject(event.content);
  if (definition == null ||
      !_hasOnlyKeys(definition, {
        'name',
        'description',
        'enabled',
        'trigger',
        'steps',
      })) {
    return null;
  }
  final name = definition['name'];
  final description = definition['description'];
  final enabled = definition['enabled'] ?? true;
  if (name is! String ||
      name.trim().isEmpty ||
      (description != null && description is! String) ||
      enabled is! bool) {
    return null;
  }
  final trigger = _parseTrigger(definition['trigger']);
  final rawSteps = definition['steps'];
  if (trigger == null || rawSteps is! List || rawSteps.length > 100) {
    return null;
  }
  final steps = <WorkflowStepRecord>[];
  final seenStepIds = <String>{};
  for (final rawStep in rawSteps) {
    final step = _parseStep(rawStep);
    if (step == null || !seenStepIds.add(step.id)) return null;
    steps.add(step);
  }
  if (steps.isEmpty && enabled) return null;

  return WorkflowRecord(
    event: event,
    workflowId: workflowId.toLowerCase(),
    channelId: channelId.toLowerCase(),
    name: name.trim(),
    description: (description as String?)?.trim(),
    trigger: trigger,
    steps: List.unmodifiable(steps),
    status: enabled ? WorkflowStatus.active : WorkflowStatus.paused,
  );
}

/// Parses a signed relay status command for the addressed workflow.
WorkflowStatusRecord? parseWorkflowStatusEvent(NostrEvent event) {
  if (event.kind != EventKind.workflowStatus || !_hasValidSignature(event)) {
    return null;
  }
  final workflowId = _singleTagValue(event, 'workflow');
  final channelId = _singleTagValue(event, 'h');
  if (workflowId == null ||
      !_uuidPattern.hasMatch(workflowId) ||
      channelId == null ||
      !_uuidPattern.hasMatch(channelId) ||
      !_hasOnlyTags(event, {'workflow', 'h'})) {
    return null;
  }
  final content = _decodeJsonObject(event.content);
  if (content == null || !_hasOnlyKeys(content, {'status'})) return null;
  final status = _parseStatus(content['status']);
  if (status == null) return null;
  return WorkflowStatusRecord(
    event: event,
    workflowId: workflowId.toLowerCase(),
    channelId: channelId.toLowerCase(),
    status: status,
  );
}

String? workflowIdFromEvent(NostrEvent event) {
  if (!_hasValidSignature(event)) return null;
  final value = event.kind == EventKind.workflowDefinition
      ? _singleTagValue(event, 'd')
      : event.kind == EventKind.workflowStatus
      ? _singleTagValue(event, 'workflow')
      : null;
  return value != null && _uuidPattern.hasMatch(value)
      ? value.toLowerCase()
      : null;
}

bool isWorkflowId(String value) => _uuidPattern.hasMatch(value);

String? _singleTagValue(NostrEvent event, String key) {
  final matching = event.tags.where(
    (tag) => tag.length == 2 && tag.first == key,
  );
  if (matching.length != 1) return null;
  return matching.single[1];
}

bool _hasAllowedDefinitionTags(NostrEvent event) {
  var revisionCount = 0;
  for (final tag in event.tags) {
    if (tag.length != 2) return false;
    switch (tag.first) {
      case 'd':
      case 'h':
        break;
      case 'expected-revision':
        revisionCount++;
        if (!_hex64Pattern.hasMatch(tag[1])) return false;
        break;
      default:
        return false;
    }
  }
  return revisionCount <= 1 &&
      event.tags.where((tag) => tag.first == 'd').length == 1 &&
      event.tags.where((tag) => tag.first == 'h').length == 1;
}

bool _hasOnlyTags(NostrEvent event, Set<String> allowed) =>
    event.tags.every((tag) => tag.length == 2 && allowed.contains(tag.first)) &&
    allowed.every(
      (key) => event.tags.where((tag) => tag.first == key).length == 1,
    );

Map<String, Object?>? _decodeYamlObject(String content) {
  try {
    final yaml = loadYaml(content);
    final value = _normalizeYaml(yaml);
    return value is Map<String, Object?> ? value : null;
  } on FormatException {
    return null;
  }
}

Object? _normalizeYaml(Object? value) {
  if (value is YamlMap || value is Map) {
    final map = value as Map;
    final result = <String, Object?>{};
    for (final entry in map.entries) {
      if (entry.key is! String) return null;
      result[entry.key as String] = _normalizeYaml(entry.value);
    }
    return result;
  }
  if (value is YamlList || value is List) {
    return (value as List).map(_normalizeYaml).toList(growable: false);
  }
  return value;
}

Map<String, Object?>? _decodeJsonObject(String content) {
  try {
    final value = jsonDecode(content);
    if (value is! Map<String, dynamic>) return null;
    return value;
  } on FormatException {
    return null;
  }
}

WorkflowTriggerRecord? _parseTrigger(Object? value) {
  if (value is! Map<String, Object?> || !_hasOnlyKeys(value, {'on', 'cron'})) {
    return null;
  }
  final on = value['on'];
  if (on == 'manual' && value.length == 1) {
    return const WorkflowTriggerRecord(frequency: 'manual');
  }
  final cron = value['cron'];
  if (on != 'schedule' || cron is! String || value.length != 2) return null;
  final match = RegExp(
    r'^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$',
  ).firstMatch(cron.trim());
  if (match == null) return null;
  final minute = int.tryParse(match[1]!);
  final hour = int.tryParse(match[2]!);
  final rawDay = match[3]!;
  if (minute == null || minute > 59 || hour == null || hour > 23) return null;
  final utcDay = rawDay == '*' ? null : int.tryParse(rawDay);
  final localHour = (hour + 2) % 24;
  final localDay = utcDay == null ? null : (utcDay + (hour >= 22 ? 1 : 0)) % 7;
  return WorkflowTriggerRecord(
    frequency: utcDay == null ? 'daily' : 'weekly',
    dayOfWeek: localDay,
    hour: localHour,
    minute: minute,
  );
}

WorkflowStepRecord? _parseStep(Object? value) {
  if (value is! Map<String, Object?>) return null;
  final id = value['id'];
  final title = value['name'] ?? '';
  if (id is! String ||
      !RegExp(r'^[A-Za-z0-9_]+$').hasMatch(id) ||
      title is! String) {
    return null;
  }
  if (value['action'] == 'ask_agent' &&
      _hasOnlyKeys(value, {
        'id',
        'name',
        'timeout_secs',
        'action',
        'agent_pubkey',
        'instruction',
        'expected_result',
      })) {
    final pubkey = value['agent_pubkey'];
    final instruction = value['instruction'];
    final timeout = value['timeout_secs'];
    if (pubkey is! String ||
        !_hex64Pattern.hasMatch(pubkey) ||
        instruction is! String ||
        instruction.trim().isEmpty ||
        (timeout != null && timeout != 900)) {
      return null;
    }
    return WorkflowStepRecord(
      id: id,
      kind: WorkflowStepKind.agent,
      title: title.trim(),
      instruction: instruction.trim(),
      assigneePubkey: pubkey.toLowerCase(),
    );
  }
  if (value['action'] == 'request_approval' &&
      _hasOnlyKeys(value, {'id', 'name', 'action', 'from', 'message'})) {
    final from = value['from'];
    final message = value['message'];
    if (from is! String || message is! String || message.trim().isEmpty) {
      return null;
    }
    final reviewerPubkey = _hex64Pattern.hasMatch(from)
        ? from.toLowerCase()
        : null;
    if (reviewerPubkey == null &&
        !const {'any', 'owner_or_admin', 'channel_member'}.contains(from)) {
      return null;
    }
    return WorkflowStepRecord(
      id: id,
      kind: WorkflowStepKind.approval,
      title: title.trim(),
      instruction: message.trim(),
      reviewerPubkey: reviewerPubkey,
      reviewerScope: reviewerPubkey == null ? from : null,
    );
  }
  return null;
}

WorkflowStatus? _parseStatus(Object? value) => switch (value) {
  'active' => WorkflowStatus.active,
  'paused' => WorkflowStatus.paused,
  _ => null,
};

bool _hasOnlyKeys(Map<String, Object?> value, Set<String> allowed) =>
    value.keys.every(allowed.contains);

bool _hasValidSignature(NostrEvent event) {
  try {
    final verified = nostr.Event.fromJson(jsonEncode(event.toJson()));
    return verified.id == event.id &&
        verified.pubkey.toLowerCase() == event.pubkey.toLowerCase();
  } catch (_) {
    return false;
  }
}
