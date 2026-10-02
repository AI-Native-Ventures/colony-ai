import 'dart:convert';

import 'package:nostr/nostr.dart' as nostr;

import '../../relay/nostr_models.dart';

const goalRecordSchemaVersion = 1;
const goalHeadQueryLimit = 10000;
const goalHistoryQueryLimit = 2000;
const maxGoalRecordBytes = 1000000;

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _hex64Pattern = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);
final _decimalPattern = RegExp(r'^-?(?:0|[1-9]\d*)(?:\.\d+)?$');

enum GoalStatus { active, offPace, achieved, archived, deleted }

extension GoalStatusWire on GoalStatus {
  String get wireValue => switch (this) {
    GoalStatus.active => 'active',
    GoalStatus.offPace => 'off_pace',
    GoalStatus.achieved => 'achieved',
    GoalStatus.archived => 'archived',
    GoalStatus.deleted => 'deleted',
  };

  String get displayLabel => switch (this) {
    GoalStatus.active => 'On track',
    GoalStatus.offPace => 'Needs attention',
    GoalStatus.achieved => 'Achieved',
    GoalStatus.archived => 'Archived',
    GoalStatus.deleted => 'Deleted goal',
  };
}

GoalStatus? _parseGoalStatus(Object? value) => switch (value) {
  'active' => GoalStatus.active,
  'off_pace' => GoalStatus.offPace,
  'achieved' => GoalStatus.achieved,
  'archived' => GoalStatus.archived,
  'deleted' => GoalStatus.deleted,
  _ => null,
};

class GoalTarget {
  const GoalTarget({required this.value, required this.unit});

  final String value;
  final String unit;
}

class GoalRecord {
  const GoalRecord({
    required this.schemaVersion,
    required this.goalId,
    required this.title,
    required this.ownerPubkey,
    required this.doneCondition,
    required this.linkedChannelIds,
    this.parentGoalId,
    this.dueDate,
    this.target,
  });

  final int schemaVersion;
  final String goalId;
  final String? parentGoalId;
  final String title;
  final String ownerPubkey;
  final String? dueDate;
  final String doneCondition;
  final GoalTarget? target;
  final List<String> linkedChannelIds;
}

class GoalProgress {
  const GoalProgress({
    required this.evidence,
    this.current,
    this.evidenceRefs = const [],
  });

  final String? current;
  final String evidence;
  final List<String> evidenceRefs;
}

class RecordedGoalProgress extends GoalProgress {
  const RecordedGoalProgress({
    required super.evidence,
    required this.recordedByPubkey,
    required this.recordedAt,
    super.current,
    super.evidenceRefs,
  });

  final String recordedByPubkey;
  final String recordedAt;
}

class GoalHead {
  const GoalHead({
    required this.schemaVersion,
    required this.goalId,
    required this.status,
    required this.title,
    required this.sourceActionEventId,
    this.goal,
    this.progress,
  });

  final int schemaVersion;
  final String goalId;
  final GoalStatus status;
  final String title;
  final GoalRecord? goal;
  final RecordedGoalProgress? progress;
  final String sourceActionEventId;
}

class GoalHeadRecord {
  const GoalHeadRecord({
    required this.dTag,
    required this.event,
    required this.head,
  });

  final String dTag;
  final NostrEvent event;
  final GoalHead head;
}

enum GoalActionType {
  create,
  update,
  progress,
  setStatus,
  archive,
  restore,
  delete,
}

extension GoalActionTypeWire on GoalActionType {
  String get wireValue => switch (this) {
    GoalActionType.create => 'create',
    GoalActionType.update => 'update',
    GoalActionType.progress => 'progress',
    GoalActionType.setStatus => 'set_status',
    GoalActionType.archive => 'archive',
    GoalActionType.restore => 'restore',
    GoalActionType.delete => 'delete',
  };
}

class GoalAction {
  const GoalAction({
    required this.goalId,
    required this.action,
    this.expectedHeadEventId,
    this.goal,
    this.progress,
    this.status,
    this.reason,
  });

  final String goalId;
  final GoalActionType action;
  final String? expectedHeadEventId;
  final GoalRecord? goal;
  final GoalProgress? progress;
  final GoalStatus? status;
  final String? reason;

  Map<String, Object?> toJson() => {
    'schemaVersion': goalRecordSchemaVersion,
    'goalId': goalId.toLowerCase(),
    'action': action.wireValue,
    if (expectedHeadEventId != null)
      'expectedHeadEventId': expectedHeadEventId!.toLowerCase(),
    if (goal != null) 'goal': _goalRecordToJson(goal!),
    if (progress != null) 'progress': _goalProgressToJson(progress!),
    if (status != null) 'status': status!.wireValue,
    if (reason != null) 'reason': reason,
  };
}

class GoalActionRecord {
  const GoalActionRecord({required this.action, required this.event});

  final GoalAction action;
  final NostrEvent event;
}

String goalDTag(String goalId) {
  if (!_uuidPattern.hasMatch(goalId)) {
    throw ArgumentError.value(goalId, 'goalId', 'Expected a goal UUID');
  }
  return 'company:goal:${goalId.toLowerCase()}';
}

String? parseGoalDTag(String value) {
  final match = RegExp(
    r'^company:goal:([0-9a-f-]{36})$',
    caseSensitive: false,
  ).firstMatch(value);
  if (match == null || !_uuidPattern.hasMatch(match[1]!)) return null;
  return match[1]!.toLowerCase();
}

String buildGoalLink(String goalId) =>
    'buzz://goal/${_readUuid(goalId, 'goal id')}';

String? parseGoalReferenceUri(Uri uri) {
  if (uri.scheme != 'buzz' ||
      uri.host != 'goal' ||
      uri.hasQuery ||
      uri.hasFragment ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.pathSegments.length != 1) {
    return null;
  }
  final goalId = uri.pathSegments.single;
  return _uuidPattern.hasMatch(goalId) ? goalId.toLowerCase() : null;
}

GoalHeadRecord? parseGoalHeadEvent(NostrEvent event, String relaySelf) {
  try {
    if (event.kind != EventKind.goalHead ||
        !_hex64Pattern.hasMatch(relaySelf) ||
        event.pubkey.toLowerCase() != relaySelf.toLowerCase() ||
        !_hasValidSignature(event)) {
      return null;
    }
  } catch (_) {
    return null;
  }
  if (!_hasOnlyDTag(event)) return null;
  final dTag = event.tags.single[1];
  final coordinateGoalId = parseGoalDTag(dTag);
  final head = _parseGoalHead(event.content);
  if (coordinateGoalId == null ||
      head == null ||
      coordinateGoalId != head.goalId) {
    return null;
  }
  return GoalHeadRecord(dTag: dTag, event: event, head: head);
}

GoalActionRecord? parseGoalActionEvent(NostrEvent event, String dTag) {
  try {
    if (event.kind != EventKind.goalAction || !_hasValidSignature(event)) {
      return null;
    }
  } catch (_) {
    return null;
  }
  if (!_hasOnlyDTag(event) || event.tags.single[1] != dTag) return null;
  final goalId = parseGoalDTag(dTag);
  if (goalId == null) return null;
  final action = _parseGoalAction(event.content, goalId);
  return action == null ? null : GoalActionRecord(action: action, event: event);
}

List<GoalHeadRecord> sortGoalHeads(Iterable<GoalHeadRecord> records) {
  final result = records.toList();
  result.sort((left, right) {
    final leftParent = left.head.goal?.parentGoalId;
    final rightParent = right.head.goal?.parentGoalId;
    if (leftParent == null && rightParent != null) return -1;
    if (leftParent != null && rightParent == null) return 1;
    final leftDue = left.head.goal?.dueDate ?? '9999-12-31';
    final rightDue = right.head.goal?.dueDate ?? '9999-12-31';
    return leftDue.compareTo(rightDue) != 0
        ? leftDue.compareTo(rightDue)
        : left.head.title.toLowerCase().compareTo(
            right.head.title.toLowerCase(),
          );
  });
  return result;
}

double? goalProgressRatio(GoalHead head) {
  final current = double.tryParse(head.progress?.current ?? '');
  final target = double.tryParse(head.goal?.target?.value ?? '');
  if (current == null || target == null || !target.isFinite || target <= 0) {
    return null;
  }
  if (!current.isFinite) return null;
  return (current / target).clamp(0, 1).toDouble();
}

String? goalProgressLabel(GoalHead head) {
  final current = head.progress?.current;
  final target = head.goal?.target;
  if (current == null || target == null) return null;
  return '$current / ${target.value} ${target.unit}';
}

bool canManageCompanyGoals(String? role) => role == 'owner' || role == 'admin';

bool canUpdateGoal({
  required String? role,
  required String? actorPubkey,
  required GoalHead head,
}) =>
    canManageCompanyGoals(role) ||
    (actorPubkey != null &&
        head.goal?.ownerPubkey.toLowerCase() == actorPubkey.toLowerCase());

bool canCreateSubgoal({
  required String? role,
  required String? actorPubkey,
  required GoalHead parent,
}) =>
    canManageCompanyGoals(role) ||
    (actorPubkey != null &&
        parent.goal?.ownerPubkey.toLowerCase() == actorPubkey.toLowerCase());

bool canRestoreOrDeleteGoal(String? role) => canManageCompanyGoals(role);

bool _hasOnlyDTag(NostrEvent event) =>
    event.tags.length == 1 &&
    event.tags.single.length == 2 &&
    event.tags.single.first == 'd';

bool _hasValidSignature(NostrEvent event) {
  final verified = nostr.Event.fromJson(jsonEncode(event.toJson()));
  return verified.id == event.id &&
      verified.pubkey.toLowerCase() == event.pubkey.toLowerCase();
}

GoalHead? _parseGoalHead(String content) {
  final value = _decodeObject(content);
  if (value == null ||
      !_onlyKeys(value, const {
        'schemaVersion',
        'goalId',
        'status',
        'title',
        'goal',
        'progress',
        'sourceActionEventId',
      }) ||
      value['schemaVersion'] != goalRecordSchemaVersion) {
    return null;
  }
  final rawGoalId = value['goalId'];
  final rawTitle = value['title'];
  final status = _parseGoalStatus(value['status']);
  final sourceActionEventId = value['sourceActionEventId'];
  if (rawGoalId is! String ||
      !_uuidPattern.hasMatch(rawGoalId) ||
      rawTitle is! String ||
      rawTitle.isEmpty ||
      status == null ||
      sourceActionEventId is! String ||
      !_hex64Pattern.hasMatch(sourceActionEventId)) {
    return null;
  }
  final goalId = rawGoalId.toLowerCase();
  final rawGoal = value['goal'];
  final goal = rawGoal == null ? null : _parseGoalRecord(rawGoal, goalId);
  final rawProgress = value['progress'];
  final progress = rawProgress == null
      ? null
      : _parseRecordedGoalProgress(rawProgress);
  if ((rawGoal != null && goal == null) ||
      (rawProgress != null && progress == null) ||
      (status == GoalStatus.deleted && (goal != null || progress != null)) ||
      (status != GoalStatus.deleted && goal == null) ||
      (goal != null && rawTitle != goal.title) ||
      (goal?.target != null && progress != null && progress.current == null)) {
    return null;
  }
  return GoalHead(
    schemaVersion: goalRecordSchemaVersion,
    goalId: goalId,
    status: status,
    title: rawTitle,
    sourceActionEventId: sourceActionEventId.toLowerCase(),
    goal: goal,
    progress: progress,
  );
}

GoalRecord? _parseGoalRecord(Object? value, String goalId) {
  if (value is! Map<String, dynamic> ||
      !_onlyKeys(value, const {
        'schemaVersion',
        'goalId',
        'parentGoalId',
        'title',
        'ownerPubkey',
        'dueDate',
        'doneCondition',
        'target',
        'linkedChannelIds',
      }) ||
      value['schemaVersion'] != goalRecordSchemaVersion ||
      value['goalId'] != goalId ||
      value['title'] is! String ||
      (value['title'] as String).trim().isEmpty ||
      (value['title'] as String).length > 180 ||
      value['ownerPubkey'] is! String ||
      !_hex64Pattern.hasMatch(value['ownerPubkey'] as String) ||
      value['doneCondition'] is! String ||
      (value['doneCondition'] as String).trim().isEmpty ||
      (value['doneCondition'] as String).length > 1000 ||
      value['linkedChannelIds'] is! List) {
    return null;
  }
  final parentValue = value['parentGoalId'];
  if (parentValue != null &&
      (parentValue is! String || !_uuidPattern.hasMatch(parentValue))) {
    return null;
  }
  final dueDateValue = value['dueDate'];
  if (dueDateValue != null &&
      (dueDateValue is! String || !_validDueDate(dueDateValue))) {
    return null;
  }
  final channels = value['linkedChannelIds'] as List;
  if (!channels.every(
    (channelId) => channelId is String && _uuidPattern.hasMatch(channelId),
  )) {
    return null;
  }
  final rawTarget = value['target'];
  GoalTarget? target;
  if (rawTarget != null) {
    if (rawTarget is! Map<String, dynamic> ||
        !_onlyKeys(rawTarget, const {'value', 'unit'}) ||
        rawTarget['value'] is! String ||
        !_decimalPattern.hasMatch(rawTarget['value'] as String) ||
        rawTarget['unit'] is! String ||
        (rawTarget['unit'] as String).isEmpty ||
        (rawTarget['unit'] as String).length > 24) {
      return null;
    }
    target = GoalTarget(
      value: rawTarget['value'] as String,
      unit: rawTarget['unit'] as String,
    );
  }
  return GoalRecord(
    schemaVersion: goalRecordSchemaVersion,
    goalId: goalId,
    parentGoalId: parentValue?.toLowerCase(),
    title: value['title'] as String,
    ownerPubkey: (value['ownerPubkey'] as String).toLowerCase(),
    dueDate: dueDateValue as String?,
    doneCondition: value['doneCondition'] as String,
    target: target,
    linkedChannelIds: channels
        .cast<String>()
        .map((id) => id.toLowerCase())
        .toList(growable: false),
  );
}

RecordedGoalProgress? _parseRecordedGoalProgress(Object? value) {
  if (value is! Map<String, dynamic> ||
      !_onlyKeys(value, const {
        'current',
        'evidence',
        'evidenceRefs',
        'recordedByPubkey',
        'recordedAt',
      }) ||
      (value['current'] != null &&
          (value['current'] is! String ||
              !_decimalPattern.hasMatch(value['current'] as String))) ||
      value['evidence'] is! String ||
      (value['evidence'] as String).trim().isEmpty ||
      (value['evidence'] as String).length > 2000 ||
      value['evidenceRefs'] is! List ||
      !(value['evidenceRefs'] as List).every((item) => item is String) ||
      value['recordedByPubkey'] is! String ||
      !_hex64Pattern.hasMatch(value['recordedByPubkey'] as String) ||
      value['recordedAt'] is! String ||
      DateTime.tryParse(value['recordedAt'] as String) == null) {
    return null;
  }
  return RecordedGoalProgress(
    current: value['current'] as String?,
    evidence: value['evidence'] as String,
    evidenceRefs: (value['evidenceRefs'] as List).cast<String>(),
    recordedByPubkey: (value['recordedByPubkey'] as String).toLowerCase(),
    recordedAt: value['recordedAt'] as String,
  );
}

GoalAction? _parseGoalAction(String content, String goalId) {
  final value = _decodeObject(content);
  if (value == null ||
      !_onlyKeys(value, const {
        'schemaVersion',
        'goalId',
        'action',
        'expectedHeadEventId',
        'goal',
        'progress',
        'status',
        'reason',
      }) ||
      value['schemaVersion'] != goalRecordSchemaVersion ||
      value['goalId'] is! String ||
      !_uuidPattern.hasMatch(value['goalId'] as String) ||
      (value['expectedHeadEventId'] != null &&
          (value['expectedHeadEventId'] is! String ||
              !_hex64Pattern.hasMatch(
                value['expectedHeadEventId'] as String,
              ))) ||
      (value['reason'] != null && value['reason'] is! String)) {
    return null;
  }
  final action = switch (value['action']) {
    'create' => GoalActionType.create,
    'update' => GoalActionType.update,
    'progress' => GoalActionType.progress,
    'set_status' => GoalActionType.setStatus,
    'archive' => GoalActionType.archive,
    'restore' => GoalActionType.restore,
    'delete' => GoalActionType.delete,
    _ => null,
  };
  if (action == null || (value['goalId'] as String).toLowerCase() != goalId) {
    return null;
  }
  final goal = value['goal'] == null
      ? null
      : _parseGoalRecord(value['goal'], goalId);
  final progress = value['progress'] == null
      ? null
      : _parseActionProgress(value['progress']);
  final status = _parseGoalStatus(value['status']);
  final allowedStatus =
      status != GoalStatus.archived && status != GoalStatus.deleted;
  final expectedHeadEventId = value['expectedHeadEventId'] as String?;
  final reason = value['reason'] as String?;
  final hasReason =
      reason != null && reason.trim().isNotEmpty && reason.length <= 1000;
  if ((value['goal'] != null && goal == null) ||
      (value['progress'] != null && progress == null) ||
      (value['status'] != null && (!allowedStatus || status == null)) ||
      (action != GoalActionType.create && expectedHeadEventId == null) ||
      (action == GoalActionType.create && goal == null) ||
      ((action == GoalActionType.create || action == GoalActionType.update) &&
          (goal == null ||
              progress != null ||
              status != null ||
              reason != null)) ||
      (action == GoalActionType.progress &&
          (progress == null || goal != null || reason != null)) ||
      (action == GoalActionType.setStatus &&
          (status == null || goal != null || progress != null || !hasReason)) ||
      (action == GoalActionType.archive &&
          (goal != null ||
              progress != null ||
              status != null ||
              (reason != null && !hasReason))) ||
      (action == GoalActionType.restore &&
          (goal != null ||
              progress != null ||
              status != null ||
              reason != null)) ||
      (action == GoalActionType.delete &&
          (goal != null ||
              progress != null ||
              status != null ||
              (reason != null && !hasReason)))) {
    return null;
  }
  return GoalAction(
    goalId: goalId,
    action: action,
    expectedHeadEventId: expectedHeadEventId,
    goal: goal,
    progress: progress,
    status: status,
    reason: reason,
  );
}

GoalProgress? _parseActionProgress(Object? value) {
  if (value is! Map<String, dynamic> ||
      !_onlyKeys(value, const {'current', 'evidence', 'evidenceRefs'}) ||
      (value['current'] != null &&
          (value['current'] is! String ||
              !_decimalPattern.hasMatch(value['current'] as String))) ||
      value['evidence'] is! String ||
      (value['evidence'] as String).trim().isEmpty ||
      (value['evidence'] as String).length > 2000 ||
      (value['evidenceRefs'] != null &&
          (value['evidenceRefs'] is! List ||
              (value['evidenceRefs'] as List).length > 20 ||
              !(value['evidenceRefs'] as List).every(
                (item) =>
                    item is String &&
                    (_hex64Pattern.hasMatch(item) ||
                        (item.startsWith('buzz://') && item.length <= 512)),
              )))) {
    return null;
  }
  return GoalProgress(
    current: value['current'] as String?,
    evidence: value['evidence'] as String,
    evidenceRefs: (value['evidenceRefs'] as List? ?? const []).cast<String>(),
  );
}

Map<String, Object?> _goalRecordToJson(GoalRecord goal) => {
  'schemaVersion': goal.schemaVersion,
  'goalId': goal.goalId,
  if (goal.parentGoalId != null) 'parentGoalId': goal.parentGoalId,
  'title': goal.title,
  'ownerPubkey': goal.ownerPubkey,
  if (goal.dueDate != null) 'dueDate': goal.dueDate,
  'doneCondition': goal.doneCondition,
  if (goal.target != null)
    'target': {'value': goal.target!.value, 'unit': goal.target!.unit},
  'linkedChannelIds': goal.linkedChannelIds,
};

Map<String, Object?> _goalProgressToJson(GoalProgress progress) => {
  if (progress.current != null) 'current': progress.current,
  'evidence': progress.evidence,
  'evidenceRefs': progress.evidenceRefs,
};

Map<String, dynamic>? _decodeObject(String content) {
  if (utf8.encode(content).length > maxGoalRecordBytes) return null;
  try {
    final value = jsonDecode(content);
    return value is Map<String, dynamic> ? value : null;
  } on FormatException {
    return null;
  }
}

bool _onlyKeys(Map<String, dynamic> value, Set<String> allowed) =>
    value.keys.every(allowed.contains);

String _readUuid(String value, String label) {
  if (!_uuidPattern.hasMatch(value)) {
    throw FormatException('$label is not a goal UUID');
  }
  return value.toLowerCase();
}

bool _validDueDate(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
  final parsed = DateTime.tryParse(value);
  return parsed != null &&
      '${parsed.year.toString().padLeft(4, '0')}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')}' ==
          value;
}
