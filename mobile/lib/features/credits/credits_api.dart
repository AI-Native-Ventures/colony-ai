import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../shared/relay/relay_provider.dart';
import '../../shared/relay/relay_session.dart';
import '../auth/account_api.dart';

const _creditsTimeout = Duration(seconds: 20);
const _maximumCreditsResponseBytes = 256 * 1024;
const _maximumCreditsHistoryEntries = 100;
const _nanoUsdPerCent = 10000000;

final creditsApiProvider = Provider<CreditsApi>((ref) {
  final relay = ref.watch(relayConfigProvider);
  return CreditsApi(
    client: ref.watch(accountHttpClientProvider),
    baseUrl: relay.baseUrl,
    nsec: relay.nsec,
  );
});

final creditsOverviewProvider = FutureProvider.autoDispose<CreditsOverview>(
  (ref) => ref.watch(creditsApiProvider).loadOverview(),
);

final creditsPaymentIntentProvider = FutureProvider.autoDispose
    .family<CreditsPaymentIntent, String>(
      (ref, reference) =>
          ref.watch(creditsApiProvider).readPaymentIntent(reference),
    );

/// Read-only account credits and payment history from the relay ledger.
class CreditsApi {
  CreditsApi({
    required http.Client client,
    required String baseUrl,
    required String? nsec,
    Duration timeout = _creditsTimeout,
    int maximumResponseBytes = _maximumCreditsResponseBytes,
  }) : _client = client,
       _baseUrl = baseUrl,
       _nsec = nsec,
       _timeout = timeout,
       _maximumResponseBytes = maximumResponseBytes;

  final http.Client _client;
  final String _baseUrl;
  final String? _nsec;
  final Duration _timeout;
  final int _maximumResponseBytes;

  /// Loads balance, current and historical usage, and the confirmed ledger.
  Future<CreditsOverview> loadOverview() async {
    final responses = await Future.wait([
      _get('balance'),
      _get('usage'),
      _get('history'),
    ]);
    final balance = responses[0];
    final usage = responses[1];
    final history = responses[2];
    if (balance['currency'] != 'USD' ||
        balance['source'] != 'account_credit_ledger') {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    final ledgerJson = history['ledger'];
    final intentJson = history['paymentIntents'];
    final monthsJson = usage['months'];
    final currentMonthJson = usage['currentMonth'];
    if (ledgerJson is! List ||
        intentJson is! List ||
        monthsJson is! List ||
        currentMonthJson is! Map ||
        ledgerJson.length > _maximumCreditsHistoryEntries ||
        intentJson.length > _maximumCreditsHistoryEntries ||
        monthsJson.length > 120) {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    return CreditsOverview(
      balanceUsdCents: _requiredInt(balance['balanceUsdCents']),
      currentMonth: CreditsUsageMonth.fromJson(
        Map<String, dynamic>.from(currentMonthJson),
      ),
      months: [
        for (final value in monthsJson)
          if (value is Map)
            CreditsUsageMonth.fromJson(Map<String, dynamic>.from(value))
          else
            throw const CreditsFailure(CreditsFailureKind.invalidResponse),
      ],
      ledger: [
        for (final value in ledgerJson)
          if (value is Map)
            CreditsLedgerEntry.fromJson(Map<String, dynamic>.from(value))
          else
            throw const CreditsFailure(CreditsFailureKind.invalidResponse),
      ],
      paymentIntents: [
        for (final value in intentJson)
          if (value is Map)
            CreditsPaymentIntent.fromJson(Map<String, dynamic>.from(value))
          else
            throw const CreditsFailure(CreditsFailureKind.invalidResponse),
      ],
    );
  }

  /// Reads one payment attempt by its existing server-issued reference.
  Future<CreditsPaymentIntent> readPaymentIntent(String reference) async {
    if (!RegExp(r'^[A-Za-z0-9._:-]{1,200}$').hasMatch(reference)) {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    return CreditsPaymentIntent.fromJson(await _get('intents/$reference'));
  }

  Future<Map<String, dynamic>> _get(String route) async {
    final nsec = _nsec;
    if (nsec == null || nsec.isEmpty) {
      throw const CreditsFailure(CreditsFailureKind.identityUnavailable);
    }
    final uri = _route(route);
    final request = http.Request('GET', uri)..followRedirects = false;
    request.headers['Authorization'] = buildNip98AuthHeader(
      method: 'GET',
      url: uri.toString(),
      bodyBytes: const [],
      nsec: nsec,
    );
    final streamed = await _client.send(request).timeout(_timeout);
    final bytes = <int>[];
    await for (final chunk in streamed.stream.timeout(_timeout)) {
      if (bytes.length + chunk.length > _maximumResponseBytes) {
        throw const CreditsFailure(CreditsFailureKind.invalidResponse);
      }
      bytes.addAll(chunk);
    }
    final response = http.Response.bytes(
      bytes,
      streamed.statusCode,
      headers: streamed.headers,
    );
    final body = _decodeObject(response);
    if (response.statusCode != 200) {
      if (body['error'] == 'account_not_found') {
        throw const CreditsFailure(CreditsFailureKind.accountNotLinked);
      }
      throw const CreditsFailure(CreditsFailureKind.unavailable);
    }
    return body;
  }

  Uri _route(String route) {
    final base = Uri.parse(_baseUrl);
    final localHost =
        base.host == 'localhost' ||
        base.host == '127.0.0.1' ||
        base.host == '::1';
    if (base.scheme != 'https' &&
        !(kDebugMode && base.scheme == 'http' && localHost)) {
      throw const CreditsFailure(CreditsFailureKind.unavailable);
    }
    final prefix = base.pathSegments.where((part) => part.isNotEmpty);
    return base.replace(
      pathSegments: [...prefix, 'api', 'payments', ...route.split('/')],
      query: null,
      fragment: null,
    );
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } on FormatException {
      // Convert malformed relay output to a stable, user-safe failure below.
    }
    throw const CreditsFailure(CreditsFailureKind.invalidResponse);
  }
}

enum CreditsFailureKind {
  accountNotLinked,
  identityUnavailable,
  invalidResponse,
  unavailable,
}

/// Expected, safe credits API failure without response bodies or credentials.
class CreditsFailure implements Exception {
  const CreditsFailure(this.kind);

  final CreditsFailureKind kind;
}

@immutable
class CreditsOverview {
  const CreditsOverview({
    required this.balanceUsdCents,
    required this.currentMonth,
    required this.months,
    required this.ledger,
    required this.paymentIntents,
  });

  final int balanceUsdCents;
  final CreditsUsageMonth currentMonth;
  final List<CreditsUsageMonth> months;
  final List<CreditsLedgerEntry> ledger;
  final List<CreditsPaymentIntent> paymentIntents;
}

@immutable
class CreditsUsageMonth {
  const CreditsUsageMonth({
    required this.month,
    required this.spentUsdCents,
    required this.entryCount,
  });

  final String month;
  final int spentUsdCents;
  final int entryCount;

  factory CreditsUsageMonth.fromJson(Map<String, dynamic> json) {
    final month = json['month'];
    if (month != null && (month is! String || !_validMonth(month))) {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    return CreditsUsageMonth(
      month: month as String? ?? '',
      spentUsdCents: _requiredInt(json['spentUsdCents']),
      entryCount: _requiredInt(json['entryCount']),
    );
  }
}

@immutable
class CreditsLedgerEntry {
  const CreditsLedgerEntry({
    required this.id,
    required this.type,
    required this.amountNanoUsd,
    required this.amountUsdCents,
    required this.description,
    required this.reference,
    required this.createdAt,
  });

  final String id;
  final String type;
  final BigInt amountNanoUsd;
  final int amountUsdCents;
  final String description;
  final String? reference;
  final DateTime createdAt;

  factory CreditsLedgerEntry.fromJson(Map<String, dynamic> json) {
    final amount = json['amountNanousd'];
    final amountNanoUsd = amount is String ? BigInt.tryParse(amount) : null;
    if (amountNanoUsd == null) {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    return CreditsLedgerEntry(
      id: _requiredString(json['id']),
      type: _requiredString(json['type']),
      amountNanoUsd: amountNanoUsd,
      amountUsdCents: _nanoUsdToCents(amount),
      description: json['description'] is String
          ? json['description'] as String
          : '',
      reference: json['reference'] as String?,
      createdAt: _requiredDate(json['createdAt']),
    );
  }
}

@immutable
class CreditsPaymentIntent {
  const CreditsPaymentIntent({
    required this.reference,
    required this.amountZarCents,
    required this.paidZarCents,
    required this.grantNanoUsd,
    required this.grantUsdCents,
    required this.status,
    required this.createdAt,
  });

  final String reference;
  final int amountZarCents;
  final int? paidZarCents;
  final BigInt grantNanoUsd;
  final int grantUsdCents;
  final String status;
  final DateTime createdAt;

  factory CreditsPaymentIntent.fromJson(Map<String, dynamic> json) {
    if (json['currency'] != 'ZAR') {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    final grant = json['grantNanousd'];
    final grantNanoUsd = grant is String ? BigInt.tryParse(grant) : null;
    final paidAmount = json['paidMinorUnits'];
    if (grantNanoUsd == null ||
        (paidAmount != null && paidAmount is! int && paidAmount is! num)) {
      throw const CreditsFailure(CreditsFailureKind.invalidResponse);
    }
    return CreditsPaymentIntent(
      reference: _requiredString(json['reference']),
      amountZarCents: _requiredInt(
        json['chargeMinorUnits'] ?? json['amountMinorUnits'],
      ),
      paidZarCents: paidAmount == null ? null : _requiredInt(paidAmount),
      grantNanoUsd: grantNanoUsd,
      grantUsdCents: _nanoUsdToCents(grant),
      status: _requiredString(json['status']),
      createdAt: _requiredDate(json['createdAt']),
    );
  }
}

int _nanoUsdToCents(String value) {
  final nanoUsd = BigInt.tryParse(value);
  if (nanoUsd == null) {
    throw const CreditsFailure(CreditsFailureKind.invalidResponse);
  }
  final divisor = BigInt.from(_nanoUsdPerCent);
  final rounding = divisor ~/ BigInt.from(2);
  final cents = nanoUsd.isNegative
      ? -((-nanoUsd + rounding) ~/ divisor)
      : (nanoUsd + rounding) ~/ divisor;
  return cents.toInt();
}

int _requiredInt(Object? value) {
  if (value is int) return value;
  if (value is num && value.isFinite && value == value.truncateToDouble()) {
    return value.toInt();
  }
  throw const CreditsFailure(CreditsFailureKind.invalidResponse);
}

String _requiredString(Object? value) {
  if (value is String && value.isNotEmpty) return value;
  throw const CreditsFailure(CreditsFailureKind.invalidResponse);
}

DateTime _requiredDate(Object? value) {
  if (value is String) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed;
  }
  throw const CreditsFailure(CreditsFailureKind.invalidResponse);
}

bool _validMonth(String month) => RegExp(r'^\d{4}-\d{2}$').hasMatch(month);
