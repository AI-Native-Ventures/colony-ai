import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../relay/relay.dart';

const _businessRecordSchemaVersion = 1;
const _businessQueryLimit = 500;
const _moneyQueryLimit = 5000;
const _channelChunkSize = 128;
const _uuidPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const _hexEventIdPattern = r'^[0-9a-f]{64}$';

const _businessScopeKinds = [
  EventKind.partyHead,
  EventKind.serviceHead,
  EventKind.proposalHead,
  EventKind.prospectHead,
];

const _discoveryRecordKinds = [
  EventKind.partyHead,
  EventKind.serviceHead,
  EventKind.proposalHead,
  EventKind.prospectHead,
  EventKind.proposalVersion,
  EventKind.proposalAcceptance,
  EventKind.proposalConversionReceipt,
];

const _moneyRecordKinds = [
  EventKind.clientHead,
  EventKind.invoiceHead,
  EventKind.moneyFollowUpHead,
  EventKind.invoiceVersion,
  EventKind.payment,
  EventKind.moneyAdjustment,
  EventKind.moneyFollowUp,
];

/// Minimal private stream metadata passed from app composition to the business
/// repository. The feature does not depend on the channel feature's model.
@immutable
class MobileBusinessChannelCandidate {
  const MobileBusinessChannelCandidate({
    required this.id,
    required this.name,
    required this.visibility,
    required this.channelType,
    required this.isMember,
    required this.archived,
  });

  final String id;
  final String name;
  final String visibility;
  final String channelType;
  final bool isMember;
  final bool archived;

  bool get isAvailable =>
      visibility == 'private' &&
      channelType == 'stream' &&
      isMember &&
      !archived;
}

/// A parsed, relay-signed business record with its NIP-29 scope and d-tag.
@immutable
class MobileBusinessRecord {
  const MobileBusinessRecord({
    required this.event,
    required this.value,
    required this.channelId,
    required this.dTag,
  });

  final NostrEvent event;
  final Map<String, Object?> value;
  final String channelId;
  final String dTag;

  String? stringValue(String key) {
    final value = this.value[key];
    return value is String ? value : null;
  }

  int? integerValue(String key) {
    final value = this.value[key];
    return value is int ? value : null;
  }

  Map<String, Object?>? objectValue(String key) {
    final value = this.value[key];
    if (value is! Map) return null;
    return value.map((key, value) => MapEntry(key as String, value));
  }
}

@immutable
class MobileDiscoveryRecords {
  const MobileDiscoveryRecords({
    required this.channelId,
    required this.services,
    required this.prospects,
    required this.proposals,
    required this.proposalVersions,
    required this.acceptances,
    required this.conversionReceipts,
  });

  final String? channelId;
  final List<MobileBusinessRecord> services;
  final List<MobileBusinessRecord> prospects;
  final List<MobileBusinessRecord> proposals;
  final List<MobileBusinessRecord> proposalVersions;
  final List<MobileBusinessRecord> acceptances;
  final List<MobileBusinessRecord> conversionReceipts;

  factory MobileDiscoveryRecords.empty() => const MobileDiscoveryRecords(
    channelId: null,
    services: [],
    prospects: [],
    proposals: [],
    proposalVersions: [],
    acceptances: [],
    conversionReceipts: [],
  );
}

@immutable
class MobileMoneyRecords {
  const MobileMoneyRecords({
    required this.clientHeads,
    required this.invoiceHeads,
    required this.invoiceVersions,
    required this.payments,
    required this.adjustments,
    required this.followUpHeads,
    required this.followUpActions,
  });

  final List<MobileBusinessRecord> clientHeads;
  final List<MobileBusinessRecord> invoiceHeads;
  final List<MobileBusinessRecord> invoiceVersions;
  final List<MobileBusinessRecord> payments;
  final List<MobileBusinessRecord> adjustments;
  final List<MobileBusinessRecord> followUpHeads;
  final List<MobileBusinessRecord> followUpActions;

  factory MobileMoneyRecords.empty() => const MobileMoneyRecords(
    clientHeads: [],
    invoiceHeads: [],
    invoiceVersions: [],
    payments: [],
    adjustments: [],
    followUpHeads: [],
    followUpActions: [],
  );
}

/// Relay seam for business reads and writes.
abstract interface class MobileBusinessRecordGateway {
  Future<List<NostrEvent>> fetch(NostrFilter filter);

  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  });
}

class RelayMobileBusinessRecordGateway implements MobileBusinessRecordGateway {
  const RelayMobileBusinessRecordGateway({
    required this.session,
    required this.nsec,
  });

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

final mobileBusinessRecordGatewayProvider =
    Provider<MobileBusinessRecordGateway>((ref) {
      return RelayMobileBusinessRecordGateway(
        session: ref.read(relaySessionProvider.notifier),
        nsec: ref.watch(relayConfigProvider).nsec,
      );
    });

final mobileBusinessRepositoryProvider = Provider<MobileBusinessRepository>(
  (ref) =>
      MobileBusinessRepository(ref.watch(mobileBusinessRecordGatewayProvider)),
);

/// Reads the signed Discovery and Money records exposed by the relay.
class MobileBusinessRepository {
  const MobileBusinessRepository(this.gateway);

  final MobileBusinessRecordGateway gateway;

  Future<MobileDiscoveryRecords> loadDiscovery(
    List<MobileBusinessChannelCandidate> channels, {
    required String communityId,
  }) async {
    final available = channels.where((channel) => channel.isAvailable).toList();
    if (available.isEmpty) return MobileDiscoveryRecords.empty();
    _validateChannelIds(available);
    if (!isMobileBusinessUuid(communityId)) {
      throw const FormatException('The active community id is invalid.');
    }

    final scopeEvents = await _fetchAcrossChannels(
      channels: available,
      kinds: _businessScopeKinds,
      eventLimit: _businessQueryLimit,
      limitMessage: 'Discovery records exceed the supported list limit.',
    );
    final candidates = {
      for (final channel in available) channel.id.toLowerCase(): channel,
    };
    final scopedChannels = <String>{};
    for (final event in scopeEvents) {
      final record = parseMobileBusinessRecord(
        event,
        expectedKinds: _businessScopeKinds.toSet(),
        expectedChannels: candidates.keys.toSet(),
      );
      _validateDiscoveryCoordinate(record, communityId);
      scopedChannels.add(record.channelId);
    }
    if (scopedChannels.length > 1) {
      throw StateError('Business records are split across private streams.');
    }

    String? channelId = scopedChannels.firstOrNull;
    if (channelId == null) {
      final salesStreams = available
          .where((channel) => channel.name.trim().toLowerCase() == 'sales')
          .toList();
      if (salesStreams.length > 1) {
        throw StateError('More than one private Sales stream is available.');
      }
      channelId = salesStreams.firstOrNull?.id.toLowerCase();
    }
    if (channelId == null) return MobileDiscoveryRecords.empty();

    final events = await gateway.fetch(
      NostrFilter(
        kinds: _discoveryRecordKinds,
        tags: {
          '#h': [channelId],
        },
        limit: _businessQueryLimit + 1,
      ),
    );
    if (events.length > _businessQueryLimit) {
      throw StateError('Discovery records exceed the supported list limit.');
    }
    final records = [
      for (final event in events)
        parseMobileBusinessRecord(
          event,
          expectedKinds: _discoveryRecordKinds.toSet(),
          expectedChannels: {channelId},
        ),
    ];
    for (final record in records) {
      _validateDiscoveryCoordinate(record, communityId);
    }
    return MobileDiscoveryRecords(
      channelId: channelId,
      services: _latestHeads(records, EventKind.serviceHead),
      prospects: _latestHeads(records, EventKind.prospectHead),
      proposals: _latestHeads(records, EventKind.proposalHead),
      proposalVersions: _recordsOfKind(records, EventKind.proposalVersion),
      acceptances: _latestHeads(records, EventKind.proposalAcceptance),
      conversionReceipts: _latestHeads(
        records,
        EventKind.proposalConversionReceipt,
      ),
    );
  }

  Future<MobileMoneyRecords> loadMoney(
    List<MobileBusinessChannelCandidate> channels,
  ) async {
    final available = channels.where((channel) => channel.isAvailable).toList();
    if (available.isEmpty) return MobileMoneyRecords.empty();
    _validateChannelIds(available);

    final records =
        await _fetchAcrossChannels(
          channels: available,
          kinds: _moneyRecordKinds,
          eventLimit: _moneyQueryLimit,
          limitMessage: 'Money history exceeds the supported record limit.',
        ).then(
          (events) => [
            for (final event in events)
              parseMobileBusinessRecord(
                event,
                expectedKinds: _moneyRecordKinds.toSet(),
                expectedChannels: {
                  for (final channel in available) channel.id.toLowerCase(),
                },
              ),
          ],
        );

    for (final record in records) {
      final clientId = record.stringValue('clientId');
      if (clientId != null && clientId.toLowerCase() != record.channelId) {
        throw const FormatException(
          'A money record does not match its client channel.',
        );
      }
      _validateMoneyCoordinate(record);
    }
    return MobileMoneyRecords(
      clientHeads: _latestHeads(records, EventKind.clientHead),
      invoiceHeads: _latestHeads(records, EventKind.invoiceHead),
      invoiceVersions: _recordsOfKind(records, EventKind.invoiceVersion),
      payments: _recordsOfKind(records, EventKind.payment),
      adjustments: _recordsOfKind(records, EventKind.moneyAdjustment),
      followUpHeads: _latestHeads(records, EventKind.moneyFollowUpHead),
      followUpActions: _recordsOfKind(records, EventKind.moneyFollowUp),
    );
  }

  Future<NostrEvent> issueInvoice(MobileBusinessRecord invoice) async {
    final current = invoice.value;
    if (current['status'] != 'draft') {
      throw StateError('Only draft invoices can be issued.');
    }
    final clientId = _requiredUuid(current, 'clientId');
    final invoiceId = _requiredUuid(current, 'invoiceId');
    final currentVersion = _requiredInteger(current, 'version');
    if (currentVersion < 1) {
      throw const FormatException('Invoice version is invalid.');
    }
    final currentVersionEventId = _requiredEventId(
      current,
      'currentVersionEventId',
    );
    final version = currentVersion + 1;
    final content = <String, Object?>{
      'schemaVersion': _businessRecordSchemaVersion,
      'clientId': clientId,
      'invoiceId': invoiceId,
      'version': version,
      'previousVersionEventId': currentVersionEventId,
      'proposalVersionEventId': current['proposalVersionEventId'],
      'expectedHeadEventId': invoice.event.id,
      'action': 'issue',
      'currency': _requiredString(current, 'currency'),
      'lines': current['lines'],
      'taxLines': current['taxLines'] ?? const [],
      'sellerTaxNumber': current['sellerTaxNumber'],
      'customerTaxNumber': current['customerTaxNumber'],
      'totalMinor': _requiredInteger(current, 'totalMinor'),
      'status': 'issued',
      'dueAt': current['dueAt'],
      'voidReason': null,
    };
    return _publishMoneyCommand(
      kind: EventKind.invoiceVersion,
      clientId: clientId,
      dTag: 'client:$clientId:invoice:$invoiceId:version:$version',
      content: content,
    );
  }

  Future<NostrEvent> updateDraftInvoiceTax({
    required MobileBusinessRecord invoice,
    required List<MobileInvoiceTaxLine> taxLines,
    required String? sellerTaxNumber,
    required String? customerTaxNumber,
  }) {
    final current = invoice.value;
    return editDraftInvoice(
      invoice: invoice,
      lines: _requiredList(current, 'lines'),
      taxLines: taxLines,
      sellerTaxNumber: sellerTaxNumber,
      customerTaxNumber: customerTaxNumber,
      dueAt: current['dueAt'] as int?,
    );
  }

  Future<NostrEvent> editDraftInvoice({
    required MobileBusinessRecord invoice,
    required List<Object?> lines,
    required List<MobileInvoiceTaxLine> taxLines,
    required String? sellerTaxNumber,
    required String? customerTaxNumber,
    required int? dueAt,
  }) async {
    final current = invoice.value;
    if (current['status'] != 'draft') {
      throw StateError('Only draft invoices can be edited.');
    }
    final clientId = _requiredUuid(current, 'clientId');
    final invoiceId = _requiredUuid(current, 'invoiceId');
    final currentVersion = _requiredInteger(current, 'version');
    final version = currentVersion + 1;
    final normalizedTaxes = [
      for (final line in taxLines)
        {
          'label': line.label?.trim().isEmpty == true
              ? null
              : line.label?.trim(),
          'rateBasisPoints': line.rateBasisPoints,
        },
    ];
    final totalMinor = _calculateInvoiceTotal(lines, taxLines);
    final content = <String, Object?>{
      'schemaVersion': _businessRecordSchemaVersion,
      'clientId': clientId,
      'invoiceId': invoiceId,
      'version': version,
      'previousVersionEventId': _requiredEventId(
        current,
        'currentVersionEventId',
      ),
      'proposalVersionEventId': current['proposalVersionEventId'],
      'expectedHeadEventId': invoice.event.id,
      'action': 'draft_edit',
      'currency': _requiredString(current, 'currency'),
      'lines': lines,
      'taxLines': normalizedTaxes,
      'sellerTaxNumber': _nullableTrimmed(sellerTaxNumber),
      'customerTaxNumber': _nullableTrimmed(customerTaxNumber),
      'totalMinor': totalMinor,
      'status': 'draft',
      'dueAt': dueAt,
      'voidReason': null,
    };
    return _publishMoneyCommand(
      kind: EventKind.invoiceVersion,
      clientId: clientId,
      dTag: 'client:$clientId:invoice:$invoiceId:version:$version',
      content: content,
    );
  }

  Future<NostrEvent> recordPayment({
    required MobileBusinessRecord invoice,
    required int amountMinor,
    required String provider,
    required String? providerReference,
    required int occurredAt,
    required String evidenceRef,
  }) async {
    final current = invoice.value;
    final clientId = _requiredUuid(current, 'clientId');
    final invoiceId = _requiredUuid(current, 'invoiceId');
    final currency = _requiredString(current, 'currency');
    final expectedHead = invoice.event.id;
    _requireAmount(amountMinor);
    _requireEventId(expectedHead);
    if (current['status'] != 'issued') {
      throw StateError('Only issued invoices can receive payment evidence.');
    }
    if (amountMinor > _requiredInteger(current, 'outstandingMinor')) {
      throw const FormatException(
        'Payment amount exceeds the invoice balance.',
      );
    }
    if (provider.trim().isEmpty || evidenceRef.trim().isEmpty) {
      throw const FormatException(
        'Payment provider and evidence are required.',
      );
    }
    final paymentId = const Uuid().v4();
    return _publishMoneyCommand(
      kind: EventKind.payment,
      clientId: clientId,
      dTag: 'client:$clientId:payment:$paymentId',
      content: {
        'schemaVersion': _businessRecordSchemaVersion,
        'clientId': clientId,
        'invoiceId': invoiceId,
        'paymentId': paymentId,
        'provider': provider.trim(),
        'providerReference': _nullableTrimmed(providerReference),
        'amountMinor': amountMinor,
        'currency': currency,
        'occurredAt': occurredAt,
        'evidenceRef': evidenceRef.trim(),
        'expectedInvoiceHeadEventId': expectedHead,
      },
    );
  }

  Future<NostrEvent> recordAdjustment({
    required MobileBusinessRecord invoice,
    required String adjustmentType,
    required int amountMinor,
    required String reason,
    required String evidenceRef,
    required int occurredAt,
  }) async {
    if (!const {
      'credit_note',
      'refund',
      'write_off',
    }.contains(adjustmentType)) {
      throw const FormatException('Adjustment type is invalid.');
    }
    if (reason.trim().isEmpty || evidenceRef.trim().isEmpty) {
      throw const FormatException(
        'Adjustment reason and evidence are required.',
      );
    }
    final current = invoice.value;
    final clientId = _requiredUuid(current, 'clientId');
    final invoiceId = _requiredUuid(current, 'invoiceId');
    final expectedHead = invoice.event.id;
    _requireAmount(amountMinor);
    _requireEventId(expectedHead);
    final adjustmentId = const Uuid().v4();
    return _publishMoneyCommand(
      kind: EventKind.moneyAdjustment,
      clientId: clientId,
      dTag: 'client:$clientId:money-adjustment:$adjustmentId',
      content: {
        'schemaVersion': _businessRecordSchemaVersion,
        'clientId': clientId,
        'invoiceId': invoiceId,
        'adjustmentId': adjustmentId,
        'adjustmentType': adjustmentType,
        'amountMinor': amountMinor,
        'currency': _requiredString(current, 'currency'),
        'reason': reason.trim(),
        'evidenceRef': evidenceRef.trim(),
        'occurredAt': occurredAt,
        'expectedInvoiceHeadEventId': expectedHead,
      },
    );
  }

  Future<NostrEvent> draftMoneyFollowUp({
    required MobileBusinessRecord invoice,
    required String draftContent,
    int? dueAt,
  }) async {
    if (draftContent.trim().isEmpty) {
      throw const FormatException('Follow-up draft cannot be empty.');
    }
    final current = invoice.value;
    final clientId = _requiredUuid(current, 'clientId');
    final invoiceId = _requiredUuid(current, 'invoiceId');
    final expectedHead = invoice.event.id;
    _requireEventId(expectedHead);
    final followUpId = const Uuid().v4();
    return _publishMoneyCommand(
      kind: EventKind.moneyFollowUp,
      clientId: clientId,
      dTag: 'client:$clientId:money-follow-up:$followUpId',
      content: {
        'schemaVersion': _businessRecordSchemaVersion,
        'clientId': clientId,
        'invoiceId': invoiceId,
        'followUpId': followUpId,
        'action': 'draft',
        'expectedHeadEventId': null,
        'expectedInvoiceHeadEventId': expectedHead,
        'dueAt': dueAt,
        'draftContent': draftContent.trim(),
      },
    );
  }

  Future<NostrEvent> _publishMoneyCommand({
    required int kind,
    required String clientId,
    required String dTag,
    required Map<String, Object?> content,
  }) => gateway.publish(
    kind: kind,
    content: jsonEncode(content),
    tags: [
      ['h', clientId],
      ['d', dTag],
    ],
  );

  Future<List<NostrEvent>> _fetchAcrossChannels({
    required List<MobileBusinessChannelCandidate> channels,
    required List<int> kinds,
    required int eventLimit,
    required String limitMessage,
  }) async {
    final events = <NostrEvent>[];
    for (var start = 0; start < channels.length; start += _channelChunkSize) {
      final ids = channels
          .skip(start)
          .take(_channelChunkSize)
          .map((channel) => channel.id.toLowerCase())
          .toList();
      final chunk = await gateway.fetch(
        NostrFilter(kinds: kinds, tags: {'#h': ids}, limit: eventLimit + 1),
      );
      if (chunk.length > eventLimit) throw StateError(limitMessage);
      events.addAll(chunk);
      if (events.length > eventLimit) throw StateError(limitMessage);
    }
    return events;
  }
}

@immutable
class MobileInvoiceTaxLine {
  const MobileInvoiceTaxLine({this.label, required this.rateBasisPoints});

  final String? label;
  final int rateBasisPoints;
}

/// Parses one relay event at the mobile production seam.
@visibleForTesting
MobileBusinessRecord parseMobileBusinessRecord(
  NostrEvent event, {
  required Set<int> expectedKinds,
  required Set<String> expectedChannels,
}) {
  if (!expectedKinds.contains(event.kind) || event.createdAt < 0) {
    throw const FormatException('Business record event metadata is invalid.');
  }
  final channelTags = event.tags
      .where((tag) => tag.firstOrNull == 'h')
      .toList();
  final dTags = event.tags.where((tag) => tag.firstOrNull == 'd').toList();
  if (channelTags.length != 1 ||
      channelTags.single.length != 2 ||
      dTags.length != 1 ||
      dTags.single.length != 2) {
    throw const FormatException('Business record coordinates are invalid.');
  }
  final channelId = channelTags.single[1].toLowerCase();
  final dTag = dTags.single[1];
  if (!expectedChannels.contains(channelId) || dTag.trim().isEmpty) {
    throw const FormatException('Business record scope is invalid.');
  }
  final decoded = jsonDecode(event.content);
  if (decoded is! Map) {
    throw const FormatException('Business record content must be an object.');
  }
  final value = decoded.map((key, value) => MapEntry(key as String, value));
  if (value['schemaVersion'] != _businessRecordSchemaVersion) {
    throw const FormatException('Business record schema is unsupported.');
  }
  return MobileBusinessRecord(
    event: event,
    value: value,
    channelId: channelId,
    dTag: dTag,
  );
}

void _validateDiscoveryCoordinate(
  MobileBusinessRecord record,
  String communityId,
) {
  final value = record.value;
  final expected = switch (record.event.kind) {
    EventKind.partyHead =>
      'business:$communityId:party:${_coordinateUuid(value, 'partyId')}',
    EventKind.serviceHead =>
      'business:$communityId:service:${_coordinateUuid(value, 'serviceId')}',
    EventKind.prospectHead =>
      'business:$communityId:prospect:${_coordinateUuid(value, 'prospectId')}',
    EventKind.proposalHead =>
      'business:$communityId:proposal:${_coordinateUuid(value, 'proposalId')}',
    EventKind.proposalVersion =>
      'business:$communityId:proposal:${_coordinateUuid(value, 'proposalId')}'
          ':version:${_coordinatePositiveInteger(value, 'revision')}',
    EventKind.proposalAcceptance || EventKind.proposalConversionReceipt =>
      'business:$communityId:conversion:${_coordinateUuid(value, 'conversionId')}',
    _ => throw const FormatException('Discovery record kind is invalid.'),
  };
  if (record.dTag != expected) {
    throw const FormatException('Discovery record coordinate is invalid.');
  }
}

void _validateMoneyCoordinate(MobileBusinessRecord record) {
  final value = record.value;
  final clientId = _coordinateUuid(value, 'clientId');
  if (clientId != record.channelId) {
    throw const FormatException('Money record client scope is invalid.');
  }
  final expected = switch (record.event.kind) {
    EventKind.clientHead => 'client:$clientId:client:$clientId',
    EventKind.invoiceHead =>
      'client:$clientId:invoice:${_coordinateUuid(value, 'invoiceId')}',
    EventKind.invoiceVersion =>
      'client:$clientId:invoice:${_coordinateUuid(value, 'invoiceId')}'
          ':version:${_coordinatePositiveInteger(value, 'version')}',
    EventKind.payment =>
      'client:$clientId:payment:${_coordinateUuid(value, 'paymentId')}',
    EventKind.moneyAdjustment =>
      'client:$clientId:money-adjustment:${_coordinateUuid(value, 'adjustmentId')}',
    EventKind.moneyFollowUpHead || EventKind.moneyFollowUp =>
      'client:$clientId:money-follow-up:${_coordinateUuid(value, 'followUpId')}',
    _ => throw const FormatException('Money record kind is invalid.'),
  };
  if (record.dTag != expected) {
    throw const FormatException('Money record coordinate is invalid.');
  }
}

String _coordinateUuid(Map<String, Object?> value, String key) {
  final candidate = value[key];
  if (candidate is! String || !isMobileBusinessUuid(candidate)) {
    throw FormatException('Business record $key is invalid.');
  }
  return candidate.toLowerCase();
}

int _coordinatePositiveInteger(Map<String, Object?> value, String key) {
  final candidate = value[key];
  if (candidate is! int || candidate < 1) {
    throw FormatException('Business record $key is invalid.');
  }
  return candidate;
}

List<MobileBusinessRecord> _recordsOfKind(
  List<MobileBusinessRecord> records,
  int kind,
) =>
    records.where((record) => record.event.kind == kind).toList()
      ..sort(_newestFirst);

List<MobileBusinessRecord> _latestHeads(
  List<MobileBusinessRecord> records,
  int kind,
) {
  final latestByTag = <String, MobileBusinessRecord>{};
  for (final record in records.where((record) => record.event.kind == kind)) {
    final existing = latestByTag[record.dTag];
    if (existing == null || _newestFirst(record, existing) < 0) {
      latestByTag[record.dTag] = record;
    }
  }
  return latestByTag.values.toList()..sort(_newestFirst);
}

int _newestFirst(MobileBusinessRecord left, MobileBusinessRecord right) {
  final createdAt = right.event.createdAt.compareTo(left.event.createdAt);
  return createdAt != 0 ? createdAt : right.event.id.compareTo(left.event.id);
}

void _validateChannelIds(List<MobileBusinessChannelCandidate> channels) {
  if (channels.length > 4096) {
    throw StateError('Too many private channels to load business records.');
  }
  for (final channel in channels) {
    if (!RegExp(_uuidPattern).hasMatch(channel.id)) {
      throw const FormatException('A private channel id is invalid.');
    }
  }
}

/// Stable validation used by business commands before they reach the relay.
@visibleForTesting
bool isMobileBusinessUuid(String value) => RegExp(_uuidPattern).hasMatch(value);

/// Event ids in business commands are exact references to signed relay heads.
@visibleForTesting
bool isMobileBusinessEventId(String value) =>
    RegExp(_hexEventIdPattern).hasMatch(value);

String _requiredUuid(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! String || !isMobileBusinessUuid(result)) {
    throw FormatException('Invoice $key is invalid.');
  }
  return result.toLowerCase();
}

String _requiredString(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! String || result.trim().isEmpty) {
    throw FormatException('Invoice $key is invalid.');
  }
  return result;
}

int _requiredInteger(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! int || result < 0) {
    throw FormatException('Invoice $key is invalid.');
  }
  return result;
}

String _requiredEventId(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! String || !isMobileBusinessEventId(result)) {
    throw FormatException('Invoice $key is invalid.');
  }
  return result.toLowerCase();
}

List<Object?> _requiredList(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! List) throw FormatException('Invoice $key is invalid.');
  return result.cast<Object?>();
}

void _requireAmount(int amountMinor) {
  if (amountMinor <= 0) {
    throw const FormatException('Amount must be greater than zero.');
  }
}

void _requireEventId(String value) {
  if (!isMobileBusinessEventId(value)) {
    throw const FormatException('Invoice reference is invalid.');
  }
}

String? _nullableTrimmed(String? value) {
  final normalized = value?.trim();
  return normalized == null || normalized.isEmpty ? null : normalized;
}

int _calculateInvoiceTotal(
  List<Object?> lines,
  List<MobileInvoiceTaxLine> taxLines,
) {
  var gross = BigInt.zero;
  for (final raw in lines) {
    if (raw is! Map) throw const FormatException('Invoice line is invalid.');
    final line = raw.map((key, value) => MapEntry(key as String, value));
    final quantity = line['quantityHundredths'];
    final amount = line['unitAmountMinor'];
    if (quantity is! int || quantity <= 0 || amount is! int || amount < 0) {
      throw const FormatException('Invoice line amount is invalid.');
    }
    final lineMinor =
        BigInt.from(quantity) * BigInt.from(amount) ~/ BigInt.from(100);
    gross += lineMinor;
    for (final tax in taxLines) {
      if (tax.rateBasisPoints < 0 || tax.rateBasisPoints > 100000) {
        throw const FormatException('Tax rate is outside the supported range.');
      }
      gross +=
          (lineMinor * BigInt.from(tax.rateBasisPoints) + BigInt.from(5000)) ~/
          BigInt.from(10000);
    }
  }
  if (gross > BigInt.from(9223372036854775807)) {
    throw const FormatException('Invoice total exceeds the supported range.');
  }
  return gross.toInt();
}
