import 'dart:convert';

import 'package:nostr/nostr.dart' as nostr;

import '../../relay/nostr_models.dart';

const memberPositionSchemaVersion = 1;
const memberPositionHeadQueryLimit = 10000;
const memberPositionTitleLimit = 180;
const memberPositionReasonLimit = 1000;

final _memberHex64 = RegExp(r'^[0-9a-f]{64}$');

enum MemberPositionKind { human, employee }

extension MemberPositionKindWire on MemberPositionKind {
  String get wireValue => switch (this) {
    MemberPositionKind.human => 'human',
    MemberPositionKind.employee => 'employee',
  };
}

enum MemberPositionStatus { active, paused, terminated }

extension MemberPositionStatusWire on MemberPositionStatus {
  String get wireValue => switch (this) {
    MemberPositionStatus.active => 'active',
    MemberPositionStatus.paused => 'paused',
    MemberPositionStatus.terminated => 'terminated',
  };

  String get displayLabel => switch (this) {
    MemberPositionStatus.active => 'Active',
    MemberPositionStatus.paused => 'Paused',
    MemberPositionStatus.terminated => 'Terminated',
  };
}

enum MemberPositionActionKind {
  setTitle,
  setManager,
  setPosition,
  pause,
  terminate,
  rehire,
}

extension MemberPositionActionKindWire on MemberPositionActionKind {
  String get wireValue => switch (this) {
    MemberPositionActionKind.setTitle => 'set_title',
    MemberPositionActionKind.setManager => 'set_manager',
    MemberPositionActionKind.setPosition => 'set_position',
    MemberPositionActionKind.pause => 'pause',
    MemberPositionActionKind.terminate => 'terminate',
    MemberPositionActionKind.rehire => 'rehire',
  };
}

class MemberPositionHead {
  const MemberPositionHead({
    required this.schemaVersion,
    required this.pubkey,
    required this.title,
    required this.kind,
    required this.status,
    required this.sourceActionEventId,
    required this.updatedAt,
    this.managerPubkey,
    this.reason,
  });

  final int schemaVersion;
  final String pubkey;
  final String title;
  final String? managerPubkey;
  final MemberPositionKind kind;
  final MemberPositionStatus status;
  final String? reason;
  final String sourceActionEventId;
  final String updatedAt;
}

class MemberPositionHeadRecord {
  const MemberPositionHeadRecord({
    required this.dTag,
    required this.event,
    required this.head,
  });

  final String dTag;
  final NostrEvent event;
  final MemberPositionHead head;
}

/// One exact-head command for the relay's member-position broker.
class MemberPositionAction {
  const MemberPositionAction({
    required this.pubkey,
    required this.action,
    this.expectedHeadEventId,
    this.title,
    this.managerPubkey,
    this.changesManager = false,
    this.reason,
  });

  final String pubkey;
  final MemberPositionActionKind action;
  final String? expectedHeadEventId;
  final String? title;
  final String? managerPubkey;

  /// Distinguishes an omitted manager from JSON null, which clears the link.
  final bool changesManager;

  final String? reason;

  Map<String, Object?> toJson() => {
    'schemaVersion': memberPositionSchemaVersion,
    'pubkey': pubkey.toLowerCase(),
    'action': action.wireValue,
    if (expectedHeadEventId != null)
      'expectedHeadEventId': expectedHeadEventId!.toLowerCase(),
    if (title != null) 'title': title,
    if (changesManager) 'managerPubkey': managerPubkey?.toLowerCase(),
    if (reason != null) 'reason': reason,
  };
}

String memberPositionDTag(String pubkey) {
  final normalized = pubkey.trim().toLowerCase();
  if (!_memberHex64.hasMatch(normalized)) {
    throw ArgumentError.value(pubkey, 'pubkey', 'Expected a 64 digit hex key');
  }
  return 'company:member:$normalized';
}

MemberPositionHeadRecord? parseMemberPositionHeadEvent(
  NostrEvent event,
  String relaySelf,
) {
  if (!_memberHex64.hasMatch(relaySelf.toLowerCase()) ||
      event.kind != EventKind.memberPositionHead ||
      event.pubkey.toLowerCase() != relaySelf.toLowerCase() ||
      !_hasValidSignature(event)) {
    return null;
  }
  if (event.tags.length != 1 ||
      event.tags.single.length != 2 ||
      event.tags.single.first != 'd') {
    return null;
  }
  final dTag = event.tags.single[1];
  final value = _decodeObject(event.content);
  if (value == null ||
      !_onlyKeys(value, const {
        'schemaVersion',
        'pubkey',
        'title',
        'managerPubkey',
        'kind',
        'status',
        'reason',
        'sourceActionEventId',
        'updatedAt',
      })) {
    return null;
  }

  final pubkey = value['pubkey'];
  final title = value['title'];
  final rawManager = value['managerPubkey'];
  final kind = switch (value['kind']) {
    'human' => MemberPositionKind.human,
    'employee' => MemberPositionKind.employee,
    _ => null,
  };
  final status = switch (value['status']) {
    'active' => MemberPositionStatus.active,
    'paused' => MemberPositionStatus.paused,
    'terminated' => MemberPositionStatus.terminated,
    _ => null,
  };
  final reason = value['reason'];
  final sourceActionEventId = value['sourceActionEventId'];
  final updatedAt = value['updatedAt'];

  if (value['schemaVersion'] != memberPositionSchemaVersion ||
      pubkey is! String ||
      !_memberHex64.hasMatch(pubkey) ||
      title is! String ||
      title.trim().isEmpty ||
      title.runes.length > memberPositionTitleLimit ||
      (rawManager != null &&
          (rawManager is! String || !_memberHex64.hasMatch(rawManager))) ||
      (rawManager == pubkey) ||
      kind == null ||
      status == null ||
      (reason != null &&
          (reason is! String ||
              reason.runes.length > memberPositionReasonLimit)) ||
      sourceActionEventId is! String ||
      !_memberHex64.hasMatch(sourceActionEventId) ||
      updatedAt is! String ||
      DateTime.tryParse(updatedAt) == null ||
      dTag != memberPositionDTag(pubkey)) {
    return null;
  }

  if (status == MemberPositionStatus.active && reason != null) return null;
  if (status != MemberPositionStatus.active &&
      (kind != MemberPositionKind.employee ||
          reason is! String ||
          reason.trim().isEmpty)) {
    return null;
  }
  if (kind == MemberPositionKind.human &&
      status != MemberPositionStatus.active) {
    return null;
  }

  return MemberPositionHeadRecord(
    dTag: dTag,
    event: event,
    head: MemberPositionHead(
      schemaVersion: memberPositionSchemaVersion,
      pubkey: pubkey,
      title: title,
      managerPubkey: rawManager as String?,
      kind: kind,
      status: status,
      reason: reason as String?,
      sourceActionEventId: sourceActionEventId,
      updatedAt: updatedAt,
    ),
  );
}

String? validateMemberPositionAction(MemberPositionAction action) {
  if (!_memberHex64.hasMatch(action.pubkey) ||
      (action.expectedHeadEventId != null &&
          !_memberHex64.hasMatch(action.expectedHeadEventId!))) {
    return 'Member identity is invalid.';
  }
  final createOnly =
      action.action == MemberPositionActionKind.setTitle ||
      action.action == MemberPositionActionKind.setPosition;
  if (action.expectedHeadEventId == null && !createOnly) {
    return 'Refresh the member record before saving.';
  }
  if (action.expectedHeadEventId == null &&
      action.action == MemberPositionActionKind.setPosition &&
      action.title == null) {
    return 'A title is required for a new position.';
  }
  if (action.title != null &&
      (action.title!.trim().isEmpty ||
          action.title!.runes.length > memberPositionTitleLimit)) {
    return 'Enter a title of 180 characters or fewer.';
  }
  if (action.reason != null &&
      (action.reason!.trim().isEmpty ||
          action.reason!.runes.length > memberPositionReasonLimit)) {
    return 'Enter a reason of 1000 characters or fewer.';
  }
  if (action.changesManager &&
      action.managerPubkey != null &&
      (!_memberHex64.hasMatch(action.managerPubkey!) ||
          action.managerPubkey == action.pubkey)) {
    return 'Choose a valid manager.';
  }

  switch (action.action) {
    case MemberPositionActionKind.setTitle:
      if (action.title == null ||
          action.changesManager ||
          action.reason != null) {
        return 'A title change needs only a title.';
      }
    case MemberPositionActionKind.setManager:
      if (action.title != null ||
          !action.changesManager ||
          action.reason != null) {
        return 'A reporting change needs only a manager.';
      }
    case MemberPositionActionKind.setPosition:
      if ((action.title == null && !action.changesManager) ||
          action.reason != null) {
        return 'A position change needs a title or manager.';
      }
    case MemberPositionActionKind.pause:
    case MemberPositionActionKind.terminate:
      if (action.title != null ||
          action.changesManager ||
          action.reason == null) {
        return 'A lifecycle change needs only a reason.';
      }
    case MemberPositionActionKind.rehire:
      if (action.title != null ||
          action.changesManager ||
          action.reason != null) {
        return 'Rehire does not take a title, manager, or reason.';
      }
  }
  return null;
}

Map<String, Object?>? _decodeObject(String content) {
  try {
    final value = jsonDecode(content);
    return value is Map<String, dynamic>
        ? value.map((key, value) => MapEntry(key, value))
        : null;
  } on FormatException {
    return null;
  }
}

bool _onlyKeys(Map<String, Object?> value, Set<String> allowed) =>
    value.keys.every(allowed.contains);

bool _hasValidSignature(NostrEvent event) {
  try {
    final verified = nostr.Event.fromJson(jsonEncode(event.toJson()));
    return verified.id == event.id &&
        verified.pubkey.toLowerCase() == event.pubkey.toLowerCase();
  } on Object {
    return false;
  }
}
