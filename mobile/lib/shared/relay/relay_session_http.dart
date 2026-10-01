part of 'relay_session.dart';

Future<List<NostrEvent>> _performRelayHttpQuery({
  required List<NostrFilter> filters,
  required Duration timeout,
  required RelayConfig config,
  required bool Function() isCurrent,
  required RelayHttpQueryClient client,
  required RelayOperationScheduler scheduler,
  required RelayRateLimitGate rateLimitGate,
}) async {
  if (!isCurrent()) throw StateError('Relay session is unavailable');
  final url = Uri.parse(config.baseUrl).resolve('/query').toString();
  final bodyBytes = utf8.encode(
    jsonEncode(filters.map((filter) => filter.toJson()).toList()),
  );
  await scheduler.acquireHttpQuery(
    isCurrent: isCurrent,
    minimumDelayMs: rateLimitGate.remainingMs,
    priority: RelayOperationPriority.visible,
  );
  if (!isCurrent()) {
    throw StateError('Relay query belongs to a retired session');
  }

  // Sign after pacing so a queued NIP-98 event cannot age while it waits.
  final response = await client.post(
    Uri.parse(url),
    headers: {
      'Authorization': buildNip98AuthHeader(
        method: 'POST',
        url: url,
        bodyBytes: bodyBytes,
        nsec: config.nsec,
      ),
      'Content-Type': 'application/json',
    },
    body: bodyBytes,
    timeout: timeout,
  );
  if (!isCurrent()) {
    throw StateError('Relay query belongs to a retired session');
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    _activateHttpRateLimitGate(rateLimitGate, response.body);
    throw RelayException(response.statusCode, response.body);
  }

  final decoded = jsonDecode(response.body);
  if (decoded is! List) {
    throw const FormatException('relay returned malformed query response');
  }
  try {
    return [
      for (final eventJson in decoded)
        if (eventJson is Map<String, dynamic>)
          NostrEvent.fromJson(eventJson)
        else
          throw const FormatException('relay returned malformed query event'),
    ];
  } catch (error) {
    if (error is FormatException) rethrow;
    throw FormatException('relay returned malformed query event: $error');
  }
}

void _activateHttpRateLimitGate(RelayRateLimitGate rateLimitGate, String body) {
  final dynamic decoded;
  try {
    decoded = jsonDecode(body);
  } on FormatException {
    return;
  }
  if (decoded is! Map<String, dynamic>) return;
  final message = decoded['error'];
  if (message is! String ||
      classifyRelayClosed(message) != RelayClosedClass.rateLimited) {
    return;
  }
  rateLimitGate.activate(parseRateLimitRetrySeconds(message));
}
