import 'dart:collection';
import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/digests/sha256.dart';

import '../../shared/relay/relay.dart';

const businessRecordSchemaVersion = 1;
const maxBusinessRecordBytes = 1000000;

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _hex32Pattern = RegExp(r'^[0-9a-f]{64}$', caseSensitive: false);

/// One stable NIP-33 coordinate that identifies a relay-owned work item head.
class WorkItemReference {
  const WorkItemReference({
    required this.clientId,
    required this.workItemId,
    required this.authorPubkey,
    required this.dTag,
  });

  final String clientId;
  final String workItemId;
  final String authorPubkey;
  final String dTag;
}

class DeliverablePointer {
  const DeliverablePointer({
    required this.deliverableId,
    required this.versionEventId,
    required this.contentDigest,
    required this.mediaDigest,
    required this.versionDigest,
  });

  final String deliverableId;
  final String versionEventId;
  final String contentDigest;
  final String mediaDigest;
  final String versionDigest;
}

class WorkItemHeadRecord {
  const WorkItemHeadRecord({
    required this.event,
    required this.clientId,
    required this.workItemId,
    required this.title,
    required this.status,
    required this.approverPubkeys,
    required this.deliverables,
  });

  final NostrEvent event;
  final String clientId;
  final String workItemId;
  final String title;
  final String status;
  final List<String> approverPubkeys;
  final List<DeliverablePointer> deliverables;
}

class DeliverableVersionRecord {
  const DeliverableVersionRecord({
    required this.event,
    required this.clientId,
    required this.workItemId,
    required this.deliverableId,
    required this.version,
    required this.contentDigest,
    required this.mediaDigests,
    required this.mediaDigest,
    required this.versionDigest,
    required this.body,
  });

  final NostrEvent event;
  final String clientId;
  final String workItemId;
  final String deliverableId;
  final int version;
  final String contentDigest;
  final List<String> mediaDigests;
  final String mediaDigest;
  final String versionDigest;
  final Object? body;

  String? get title => _stringField(body, 'title');
  String? get content => _stringField(body, 'content');
}

enum DeliverableApprovalDecision { approved, changesRequested, rejected }

class DeliverableApprovalRecord {
  const DeliverableApprovalRecord({
    required this.event,
    required this.clientId,
    required this.workItemId,
    required this.deliverableId,
    required this.versionEventId,
    required this.contentDigest,
    required this.mediaDigest,
    required this.decision,
    required this.note,
  });

  final NostrEvent event;
  final String clientId;
  final String workItemId;
  final String deliverableId;
  final String versionEventId;
  final String contentDigest;
  final String mediaDigest;
  final DeliverableApprovalDecision decision;
  final String? note;
}

/// Parses and validates the exact work item coordinate carried by a message.
WorkItemReference? workItemReferenceFromTags(
  List<List<String>> tags, {
  required String clientId,
}) {
  final references = [
    for (final tag in tags)
      if (tag.length >= 2 && tag.first == 'a' && tag[1].startsWith('30634:'))
        tag[1],
  ];
  if (references.isEmpty) return null;
  if (references.length != 1) return null;
  try {
    return parseWorkItemReferenceCoordinate(references.single, clientId);
  } on FormatException {
    return null;
  }
}

/// Parses a `30634:<author>:client:<id>:work:<id>` addressable coordinate.
WorkItemReference? parseWorkItemReferenceCoordinate(
  String coordinate,
  String clientId,
) {
  final normalizedClientId = _tryReadUuid(clientId);
  if (normalizedClientId == null) return null;
  final firstSeparator = coordinate.indexOf(':');
  final secondSeparator = coordinate.indexOf(':', firstSeparator + 1);
  if (firstSeparator < 1 || secondSeparator < 0) return null;
  if (int.tryParse(coordinate.substring(0, firstSeparator)) !=
      EventKind.workItemHead) {
    return null;
  }
  final author = coordinate.substring(firstSeparator + 1, secondSeparator);
  if (!_hex32Pattern.hasMatch(author)) return null;
  final dTag = coordinate.substring(secondSeparator + 1);
  final prefix = 'client:$normalizedClientId:work:';
  if (!dTag.startsWith(prefix)) return null;
  final workItemId = _tryReadUuid(dTag.substring(prefix.length));
  if (workItemId == null ||
      _workItemDTag(normalizedClientId, workItemId) != dTag) {
    return null;
  }
  return WorkItemReference(
    clientId: normalizedClientId,
    workItemId: workItemId,
    authorPubkey: author.toLowerCase(),
    dTag: dTag,
  );
}

WorkItemHeadRecord parseWorkItemHead(NostrEvent event) {
  if (event.kind != EventKind.workItemHead) {
    throw const FormatException('event is not a work item head');
  }
  final channelId = _readUniqueTag(event, 'h').toLowerCase();
  _readUuid(channelId, 'client channel id');
  final record = _parseContent(event);
  final clientId = _readUuid(_string(record, 'clientId'), 'client id');
  final workItemId = _readUuid(_string(record, 'workItemId'), 'work item id');
  _validateCoordinates(event, clientId, _workItemDTag(clientId, workItemId));
  if (clientId != channelId) {
    throw const FormatException('work item head is outside its client channel');
  }
  final title = _string(record, 'title').trim();
  final status = _string(record, 'status').trim();
  _pubkeys(record['assignedPubkeys']);
  final approverPubkeys = _pubkeys(record['approverPubkeys']);
  _readHex32(_string(record, 'sourceEventId'));
  final rawDeliverables = record['deliverables'];
  if (title.isEmpty || status.isEmpty || rawDeliverables is! List) {
    throw const FormatException('work item head fields are invalid');
  }
  return WorkItemHeadRecord(
    event: event,
    clientId: clientId,
    workItemId: workItemId,
    title: title,
    status: status,
    approverPubkeys: approverPubkeys,
    deliverables: rawDeliverables.map(_parsePointer).toList(growable: false),
  );
}

DeliverableVersionRecord parseDeliverableVersion(NostrEvent event) {
  if (event.kind != EventKind.deliverableVersion) {
    throw const FormatException('event is not a deliverable version');
  }
  final channelId = _readUniqueTag(event, 'h').toLowerCase();
  final record = _parseContent(event);
  final clientId = _readUuid(_string(record, 'clientId'), 'client id');
  final workItemId = _readUuid(_string(record, 'workItemId'), 'work item id');
  final deliverableId = _readUuid(
    _string(record, 'deliverableId'),
    'deliverable id',
  );
  final version = record['version'];
  if (version is! int || version < 1) {
    throw const FormatException(
      'deliverable version must be a positive integer',
    );
  }
  final previousVersionEventId = record['previousVersionEventId'];
  if (version == 1) {
    if (previousVersionEventId != null) {
      throw const FormatException(
        'first deliverable version cannot have a prior event',
      );
    }
  } else if (previousVersionEventId is! String) {
    throw const FormatException(
      'deliverable revision must name its prior event',
    );
  } else {
    _readHex32(previousVersionEventId);
  }
  _validateCoordinates(
    event,
    clientId,
    _deliverableVersionDTag(clientId, deliverableId, version),
  );
  if (clientId != channelId) {
    throw const FormatException(
      'deliverable version is outside its client channel',
    );
  }
  final rawMediaDigests = record['mediaDigests'];
  if (rawMediaDigests is! List ||
      !rawMediaDigests.every(
        (item) => item is String && _hex32Pattern.hasMatch(item),
      )) {
    throw const FormatException('deliverable media digests are invalid');
  }
  final mediaDigests = rawMediaDigests.cast<String>().toList();
  for (var i = 1; i < mediaDigests.length; i++) {
    if (mediaDigests[i - 1].compareTo(mediaDigests[i]) >= 0) {
      throw const FormatException(
        'deliverable media digests are not sorted and unique',
      );
    }
  }
  final body = record['body'];
  if (!record.containsKey('body')) {
    throw const FormatException('deliverable body is missing');
  }
  final contentDigest = _readDigest(_string(record, 'contentDigest'));
  if (_digestBytes(utf8.encode(canonicalBusinessJson(body))) != contentDigest) {
    throw const FormatException('deliverable body digest does not match');
  }
  final mediaDigest = _digestBytes(utf8.encode(jsonEncode(mediaDigests)));
  return DeliverableVersionRecord(
    event: event,
    clientId: clientId,
    workItemId: workItemId,
    deliverableId: deliverableId,
    version: version,
    contentDigest: contentDigest,
    mediaDigests: mediaDigests,
    mediaDigest: mediaDigest,
    versionDigest: _digestBytes([
      ..._hexToBytes(contentDigest),
      ..._hexToBytes(mediaDigest),
    ]),
    body: body,
  );
}

DeliverableApprovalRecord parseDeliverableApproval(NostrEvent event) {
  if (event.kind != EventKind.deliverableApproval) {
    throw const FormatException('event is not a deliverable approval');
  }
  final channelId = _readUniqueTag(event, 'h').toLowerCase();
  final record = _parseContent(event);
  final clientId = _readUuid(_string(record, 'clientId'), 'client id');
  final versionEventId = _readHex32(_string(record, 'versionEventId'));
  _validateCoordinates(
    event,
    clientId,
    _deliverableApprovalDTag(clientId, versionEventId),
  );
  if (clientId != channelId) {
    throw const FormatException(
      'deliverable approval is outside its client channel',
    );
  }
  final decision = switch (_string(record, 'decision')) {
    'approved' => DeliverableApprovalDecision.approved,
    'changes_requested' => DeliverableApprovalDecision.changesRequested,
    'rejected' => DeliverableApprovalDecision.rejected,
    _ => throw const FormatException(
      'deliverable approval decision is invalid',
    ),
  };
  final noteValue = record['note'];
  if (noteValue != null && noteValue is! String) {
    throw const FormatException(
      'deliverable approval note must be text or null',
    );
  }
  return DeliverableApprovalRecord(
    event: event,
    clientId: clientId,
    workItemId: _readUuid(_string(record, 'workItemId'), 'work item id'),
    deliverableId: _readUuid(
      _string(record, 'deliverableId'),
      'deliverable id',
    ),
    versionEventId: versionEventId,
    contentDigest: _readDigest(_string(record, 'contentDigest')),
    mediaDigest: _readDigest(_string(record, 'mediaDigest')),
    decision: decision,
    note: noteValue as String?,
  );
}

String canonicalBusinessJson(Object? value) =>
    jsonEncode(_canonicalValue(value));

Object? _canonicalValue(Object? value) {
  if (value is Map) {
    final keys = value.keys;
    if (!keys.every((key) => key is String)) {
      throw const FormatException('business record JSON keys must be strings');
    }
    final sorted = SplayTreeMap<String, Object?>();
    for (final key in keys.cast<String>()) {
      sorted[key] = _canonicalValue(value[key]);
    }
    return sorted;
  }
  if (value is List) return value.map(_canonicalValue).toList(growable: false);
  if (value == null || value is String || value is num || value is bool) {
    return value;
  }
  throw const FormatException('business record body contains unsupported JSON');
}

Map<String, dynamic> _parseContent(NostrEvent event) {
  if (utf8.encode(event.content).length > maxBusinessRecordBytes) {
    throw const FormatException(
      'business record content exceeds the size limit',
    );
  }
  final decoded = jsonDecode(event.content);
  if (decoded is! Map<String, dynamic> ||
      decoded['schemaVersion'] != businessRecordSchemaVersion) {
    throw const FormatException(
      'business record schema version is unsupported',
    );
  }
  return decoded;
}

DeliverablePointer _parsePointer(Object? value) {
  if (value is! Map<String, dynamic>) {
    throw const FormatException('work item deliverable pointer is invalid');
  }
  return DeliverablePointer(
    deliverableId: _readUuid(_string(value, 'deliverableId'), 'deliverable id'),
    versionEventId: _readHex32(_string(value, 'versionEventId')),
    contentDigest: _readDigest(_string(value, 'contentDigest')),
    mediaDigest: _readDigest(_string(value, 'mediaDigest')),
    versionDigest: _readDigest(_string(value, 'versionDigest')),
  );
}

String _readUniqueTag(NostrEvent event, String name) {
  final values = event.tags
      .where((tag) => tag.isNotEmpty && tag.first == name)
      .toList();
  if (values.length != 1 ||
      values.single.length < 2 ||
      values.single[1].isEmpty) {
    throw FormatException('business record requires exactly one $name tag');
  }
  return values.single[1];
}

void _validateCoordinates(NostrEvent event, String clientId, String dTag) {
  if (_readUniqueTag(event, 'h').toLowerCase() != clientId ||
      _readUniqueTag(event, 'd') != dTag) {
    throw const FormatException('business record coordinates do not match');
  }
}

List<String> _pubkeys(Object? value) {
  if (value is! List ||
      !value.every((item) => item is String && _hex32Pattern.hasMatch(item))) {
    throw const FormatException('work item approvers are invalid');
  }
  return value
      .cast<String>()
      .map((item) => item.toLowerCase())
      .toList(growable: false);
}

String _string(Map<String, dynamic> record, String key) {
  final value = record[key];
  if (value is! String)
    throw FormatException('business record $key is invalid');
  return value;
}

String _readUuid(String value, String label) {
  if (!_uuidPattern.hasMatch(value))
    throw FormatException('$label is not a UUID');
  return value.toLowerCase();
}

String? _tryReadUuid(String value) =>
    _uuidPattern.hasMatch(value) ? value.toLowerCase() : null;

String _readHex32(String value) {
  if (!_hex32Pattern.hasMatch(value))
    throw const FormatException('event id is invalid');
  return value.toLowerCase();
}

String _readDigest(String value) => _readHex32(value);

String _workItemDTag(String clientId, String workItemId) =>
    'client:$clientId:work:$workItemId';

String _deliverableVersionDTag(
  String clientId,
  String deliverableId,
  int version,
) => 'client:$clientId:deliverable:$deliverableId:version:$version';

String _deliverableApprovalDTag(String clientId, String versionEventId) =>
    'client:$clientId:deliverable-approval:$versionEventId';

String _digestBytes(List<int> bytes) => SHA256Digest()
    .process(Uint8List.fromList(bytes))
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();

List<int> _hexToBytes(String hex) => [
  for (var index = 0; index < hex.length; index += 2)
    int.parse(hex.substring(index, index + 2), radix: 16),
];

String? _stringField(Object? body, String key) {
  if (body is! Map<String, dynamic>) return null;
  final value = body[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}
