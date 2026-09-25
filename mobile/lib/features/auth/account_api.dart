import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../shared/relay/relay_provider.dart';
import '../../shared/relay/relay_session.dart';
import 'account_auth_types.dart';

const _requestTimeout = Duration(seconds: 20);

/// Provides the bounded HTTP client used by account requests.
final accountHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

/// Provides account routes on the currently configured relay host.
final accountApiProvider = Provider<AccountApi>((ref) {
  return AccountApi(
    client: ref.watch(accountHttpClientProvider),
    baseUrl: ref.watch(relayConfigProvider).baseUrl,
  );
});

/// Makes bounded HTTPS JSON requests to the deployment's account routes.
class AccountApi {
  /// Creates an account API client for one relay host.
  AccountApi({
    required http.Client client,
    required String baseUrl,
    Duration timeout = _requestTimeout,
    int maximumResponseBytes = 64 * 1024,
  }) : _client = client,
       _baseUrl = baseUrl,
       _timeout = timeout,
       _maximumResponseBytes = maximumResponseBytes;

  final http.Client _client;
  final String _baseUrl;
  final Duration _timeout;
  final int _maximumResponseBytes;

  /// Starts account creation and sends the verification code.
  Future<AccountCodeDelivery> signup({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final response = await _send(
      'POST',
      'signup',
      body: {
        'email': email,
        'password': password,
        if (displayName != null) 'display_name': displayName,
      },
    );
    _expectStatus(response, const {202});
    return _codeDelivery(response);
  }

  /// Requests another verification or password reset code.
  Future<AccountCodeDelivery> resendCode({
    required String email,
    required AccountCodePurpose purpose,
  }) async {
    final response = await _send(
      'POST',
      'resend-code',
      body: {'email': email, 'purpose': purpose.name},
    );
    _expectStatus(response, const {202});
    return _codeDelivery(response);
  }

  /// Verifies an email code and returns the resulting authenticated session.
  Future<AccountSession> verify({
    required String email,
    required String code,
  }) async {
    final response = await _send(
      'POST',
      'verify',
      body: {'email': email, 'code': code},
    );
    _expectStatus(response, const {200});
    return AccountSession.fromJson(_decodeObject(response));
  }

  /// Signs in with email and password.
  Future<AccountSession> signIn({
    required String email,
    required String password,
  }) async {
    final response = await _send(
      'POST',
      'signin',
      body: {'email': email, 'password': password},
    );
    _expectStatus(response, const {200});
    return AccountSession.fromJson(_decodeObject(response));
  }

  /// Requests a password reset code without revealing account existence.
  Future<AccountCodeDelivery> requestPasswordReset({
    required String email,
  }) async {
    final response = await _send(
      'POST',
      'reset/request',
      body: {'email': email},
    );
    _expectStatus(response, const {202});
    return _codeDelivery(response);
  }

  /// Checks a reset code without consuming the code needed to set a password.
  Future<void> checkPasswordResetCode({
    required String email,
    required String code,
  }) async {
    final response = await _send(
      'POST',
      'reset/check',
      body: {'email': email, 'code': code},
    );
    _expectStatus(response, const {200});
    if (_decodeObject(response)['status'] != 'code_valid') {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }
  }

  /// Confirms a reset code and returns the restored account session.
  Future<AccountSession> confirmPasswordReset({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    final response = await _send(
      'POST',
      'reset/confirm',
      body: {'email': email, 'code': code, 'new_password': newPassword},
    );
    _expectStatus(response, const {200});
    return AccountSession.fromJson(_decodeObject(response));
  }

  /// Signs in or creates an account with a Google ID token.
  Future<AccountSession> signInWithGoogle({required String idToken}) async {
    final response = await _send('POST', 'google', body: {'id_token': idToken});
    _expectStatus(response, const {200});
    return AccountSession.fromJson(_decodeObject(response));
  }

  /// Claims the active Nostr identity and requests email verification.
  Future<void> claim({
    required String email,
    required String password,
    required String nsec,
  }) async {
    final response = await _send(
      'POST',
      'claim',
      body: {'email': email, 'password': password, 'nsec': nsec},
      nsec: nsec,
    );
    _expectStatus(response, const {202});
  }

  /// Returns the account linked to an identity, if one exists.
  Future<AccountProfile> me({required String nsec}) async {
    final response = await _send('GET', 'me', nsec: nsec);
    if (response.statusCode == 404) {
      final body = _decodeObject(response, allowEmpty: true);
      if (body['error'] == 'account_not_found') {
        throw const AccountAuthFailure(AccountAuthFailureKind.accountMissing);
      }
    }
    _expectStatus(response, const {200});
    final accountJson = _decodeObject(response)['account'];
    if (accountJson is! Map) {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }
    return AccountProfile.fromJson(Map<String, dynamic>.from(accountJson));
  }

  Future<http.Response> _send(
    String method,
    String route, {
    Map<String, Object?>? body,
    String? nsec,
  }) async {
    final uri = _route(route);
    final request = http.Request(method, uri)..followRedirects = false;
    final bodyBytes = body == null ? <int>[] : utf8.encode(jsonEncode(body));
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.bodyBytes = bodyBytes;
    }
    if (nsec != null) {
      request.headers['Authorization'] = buildNip98AuthHeader(
        method: method,
        url: uri.toString(),
        bodyBytes: bodyBytes,
        nsec: nsec,
      );
    }

    final streamed = await _client.send(request).timeout(_timeout);
    final bodyStream = streamed.stream.timeout(_timeout);
    final bytes = <int>[];
    await for (final chunk in bodyStream) {
      if (bytes.length + chunk.length > _maximumResponseBytes) {
        throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
      }
      bytes.addAll(chunk);
    }
    return http.Response.bytes(
      bytes,
      streamed.statusCode,
      request: streamed.request,
      headers: streamed.headers,
      isRedirect: streamed.isRedirect,
      persistentConnection: streamed.persistentConnection,
    );
  }

  Uri _route(String route) {
    final base = Uri.parse(_baseUrl);
    final localHost =
        base.host == 'localhost' ||
        base.host == '127.0.0.1' ||
        base.host == '::1';
    if (base.scheme != 'https' &&
        !(kDebugMode && base.scheme == 'http' && localHost)) {
      throw const AccountAuthFailure(AccountAuthFailureKind.unavailable);
    }
    final prefix = base.pathSegments.where((part) => part.isNotEmpty);
    return base.replace(
      pathSegments: [...prefix, 'api', 'accounts', ...route.split('/')],
      query: null,
      fragment: null,
    );
  }

  void _expectStatus(http.Response response, Set<int> accepted) {
    if (accepted.contains(response.statusCode)) return;
    final body = _decodeObject(response, allowEmpty: true);
    final retry = body['retry_after_secs'];
    final attempts = body['attempts_left'];
    throw AccountAuthFailure(
      _failureKind(body['error'], response.statusCode),
      retryAfterSecs: retry is num ? retry.toInt().clamp(0, 86400) : null,
      attemptsLeft: attempts is num ? attempts.toInt().clamp(0, 5) : null,
    );
  }

  AccountCodeDelivery _codeDelivery(http.Response response) {
    final body = _decodeObject(response);
    if (body['status'] != 'verification_sent') {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }
    final retry = body['retry_after_secs'];
    return AccountCodeDelivery(
      retryAfterSecs: retry is num ? retry.toInt().clamp(0, 86400) : null,
    );
  }

  Map<String, dynamic> _decodeObject(
    http.Response response, {
    bool allowEmpty = false,
  }) {
    if (response.body.isEmpty && allowEmpty) return const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } on FormatException {
      // Convert malformed relay output to a stable, user-safe failure below.
    }
    throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
  }

  AccountAuthFailureKind _failureKind(Object? error, int status) =>
      switch (error) {
        'invalid_request' => AccountAuthFailureKind.invalidRequest,
        'invalid_credentials' => AccountAuthFailureKind.invalidCredentials,
        'email_unverified' => AccountAuthFailureKind.emailUnverified,
        'email_taken' => AccountAuthFailureKind.emailTaken,
        'identity_taken' => AccountAuthFailureKind.identityTaken,
        'code_expired' => AccountAuthFailureKind.codeExpired,
        'wrong_code' => AccountAuthFailureKind.wrongCode,
        'too_many_attempts' => AccountAuthFailureKind.tooManyAttempts,
        'resend_cooldown' => AccountAuthFailureKind.resendCooldown,
        'weak_password' => AccountAuthFailureKind.weakPassword,
        'rate_limited' => AccountAuthFailureKind.rateLimited,
        'account_not_found' when status == 404 =>
          AccountAuthFailureKind.accountMissing,
        _ => AccountAuthFailureKind.unavailable,
      };
}
