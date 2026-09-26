import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:nostr/nostr.dart' as nostr;
import 'package:pointycastle/digests/sha256.dart';
import 'package:buzz/features/auth/account_api.dart';
import 'package:buzz/features/auth/account_auth_types.dart';

void main() {
  test(
    'sends each unauthenticated flow to its contract route and payload',
    () async {
      final requests = <http.Request>[];
      final client = http_testing.MockClient((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/verify') ||
            request.url.path.endsWith('/signin') ||
            request.url.path.endsWith('/reset/confirm') ||
            request.url.path.endsWith('/google')) {
          return http.Response(_sessionBody, 200);
        }
        if (request.url.path.endsWith('/reset/check')) {
          return http.Response('{"status":"code_valid"}', 200);
        }
        return http.Response(
          '{"status":"verification_sent","retry_after_secs":30}',
          202,
        );
      });
      final api = AccountApi(client: client, baseUrl: 'https://relay.example/');

      final signup = await api.signup(
        email: 'a@example.com',
        password: 'a-password-10',
        displayName: 'Ada Example',
      );
      expect(signup.retryAfterSecs, 30);
      await api.verify(email: 'a@example.com', code: '123456');
      await api.resendCode(
        email: 'a@example.com',
        purpose: AccountCodePurpose.verify,
      );
      await api.signIn(email: 'a@example.com', password: 'a-password-10');
      await api.requestPasswordReset(email: 'a@example.com');
      await api.checkPasswordResetCode(email: 'a@example.com', code: '654321');
      await api.confirmPasswordReset(
        email: 'a@example.com',
        code: '654321',
        newPassword: 'new-password-10',
      );
      await api.signInWithGoogle(idToken: 'generated-test-id-token');
      client.close();

      expect(
        requests.map((request) => '${request.method} ${request.url.path}'),
        [
          'POST /api/accounts/signup',
          'POST /api/accounts/verify',
          'POST /api/accounts/resend-code',
          'POST /api/accounts/signin',
          'POST /api/accounts/reset/request',
          'POST /api/accounts/reset/check',
          'POST /api/accounts/reset/confirm',
          'POST /api/accounts/google',
        ],
      );
      expect(jsonDecode(requests[0].body), {
        'email': 'a@example.com',
        'password': 'a-password-10',
        'display_name': 'Ada Example',
      });
      expect(jsonDecode(requests[1].body), {
        'email': 'a@example.com',
        'code': '123456',
      });
      expect(jsonDecode(requests[2].body), {
        'email': 'a@example.com',
        'purpose': 'verify',
      });
      expect(jsonDecode(requests[3].body), {
        'email': 'a@example.com',
        'password': 'a-password-10',
      });
      expect(jsonDecode(requests[4].body), {'email': 'a@example.com'});
      expect(jsonDecode(requests[5].body), {
        'email': 'a@example.com',
        'code': '654321',
      });
      expect(jsonDecode(requests[6].body), {
        'email': 'a@example.com',
        'code': '654321',
        'new_password': 'new-password-10',
      });
      expect(jsonDecode(requests[7].body), {
        'id_token': 'generated-test-id-token',
      });
      expect(requests.every((request) => !request.followRedirects), isTrue);
    },
  );

  test(
    'claim binds the JSON payload to a NIP-98 POST signed by its nsec',
    () async {
      final keys = nostr.Keys.generate();
      late http.Request captured;
      final client = http_testing.MockClient((request) async {
        captured = request;
        return http.Response('{"status":"verification_sent"}', 202);
      });
      final api = AccountApi(client: client, baseUrl: 'https://relay.example');

      await api.claim(
        email: 'claim@example.com',
        password: 'generated-test-password',
        nsec: keys.nsec,
      );
      client.close();

      expect(
        captured.url.toString(),
        'https://relay.example/api/accounts/claim',
      );
      expect(jsonDecode(captured.body), {
        'email': 'claim@example.com',
        'password': 'generated-test-password',
        'nsec': keys.nsec,
      });
      final auth = captured.headers['Authorization']!;
      expect(auth, startsWith('Nostr '));
      final signed =
          jsonDecode(
                utf8.decode(base64.decode(auth.substring('Nostr '.length))),
              )
              as Map<String, dynamic>;
      final tags = (signed['tags'] as List<dynamic>)
          .map((tag) => (tag as List<dynamic>).cast<String>())
          .toList();
      final payloadHash = SHA256Digest()
          .process(captured.bodyBytes)
          .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
          .join();
      expect(signed['kind'], 27235);
      expect(signed['pubkey'], keys.public);
      expect(tags, contains(equals(['u', captured.url.toString()])));
      expect(tags, contains(equals(['method', 'POST'])));
      expect(tags, contains(equals(['payload', payloadHash])));
    },
  );

  test('me uses NIP-98 and parses the account profile', () async {
    final keys = nostr.Keys.generate();
    late http.Request captured;
    final client = http_testing.MockClient((request) async {
      captured = request;
      return http.Response(
        '{"account":{"id":"a1","email":"a@example.com",'
        '"pubkey":"${keys.public}","has_password":true,"google_linked":false}}',
        200,
      );
    });
    final api = AccountApi(client: client, baseUrl: 'https://relay.example');

    final account = await api.me(nsec: keys.nsec);
    client.close();

    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/accounts/me');
    expect(captured.headers['Authorization'], startsWith('Nostr '));
    expect(account.email, 'a@example.com');
    expect(account.pubkey, keys.public);
    expect(account.hasPassword, isTrue);
    expect(account.googleLinked, isFalse);
  });

  test(
    'me treats only the explicit missing-account response as unlinked',
    () async {
      final api = AccountApi(
        client: http_testing.MockClient(
          (_) async => http.Response('{"error":"account_not_found"}', 404),
        ),
        baseUrl: 'https://relay.example',
      );

      await expectLater(
        api.me(nsec: nostr.Keys.generate().nsec),
        throwsA(
          isA<AccountAuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            AccountAuthFailureKind.accountMissing,
          ),
        ),
      );
    },
  );

  test('maps contract errors and rate limit retry seconds', () async {
    final cases = [
      (
        400,
        '{"error":"invalid_request"}',
        AccountAuthFailureKind.invalidRequest,
      ),
      (
        401,
        '{"error":"invalid_credentials"}',
        AccountAuthFailureKind.invalidCredentials,
      ),
      (
        403,
        '{"error":"email_unverified"}',
        AccountAuthFailureKind.emailUnverified,
      ),
      (409, '{"error":"email_taken"}', AccountAuthFailureKind.emailTaken),
      (409, '{"error":"identity_taken"}', AccountAuthFailureKind.identityTaken),
      (410, '{"error":"code_expired"}', AccountAuthFailureKind.codeExpired),
      (422, '{"error":"weak_password"}', AccountAuthFailureKind.weakPassword),
      (
        422,
        '{"error":"wrong_code","attempts_left":3}',
        AccountAuthFailureKind.wrongCode,
      ),
      (
        429,
        '{"error":"rate_limited","retry_after_secs":31}',
        AccountAuthFailureKind.rateLimited,
      ),
    ];

    for (final (status, body, expectedKind) in cases) {
      final client = http_testing.MockClient(
        (_) async => http.Response(body, status),
      );
      final api = AccountApi(client: client, baseUrl: 'https://relay.example');
      await expectLater(
        api.signup(email: 'a@example.com', password: 'password-1234'),
        throwsA(
          isA<AccountAuthFailure>().having(
            (failure) => failure.kind,
            'kind',
            expectedKind,
          ),
        ),
      );
      if (status == 429) {
        await expectLater(
          api.resendCode(
            email: 'a@example.com',
            purpose: AccountCodePurpose.verify,
          ),
          throwsA(
            isA<AccountAuthFailure>().having(
              (failure) => failure.retryAfterSecs,
              'retryAfterSecs',
              31,
            ),
          ),
        );
      }
      client.close();
    }
  });

  test('preserves account-code retry fields as typed failures', () async {
    final cases = [
      (
        '{"error":"too_many_attempts","retry_after_secs":91}',
        AccountAuthFailureKind.tooManyAttempts,
        91,
      ),
      (
        '{"error":"resend_cooldown","retry_after_secs":24}',
        AccountAuthFailureKind.resendCooldown,
        24,
      ),
    ];

    for (final (body, expectedKind, retryAfterSecs) in cases) {
      final client = http_testing.MockClient(
        (_) async => http.Response(body, 429),
      );
      final api = AccountApi(client: client, baseUrl: 'https://relay.example');
      await expectLater(
        api.resendCode(
          email: 'a@example.com',
          purpose: AccountCodePurpose.reset,
        ),
        throwsA(
          isA<AccountAuthFailure>()
              .having((failure) => failure.kind, 'kind', expectedKind)
              .having(
                (failure) => failure.retryAfterSecs,
                'retryAfterSecs',
                retryAfterSecs,
              ),
        ),
      );
      client.close();
    }

    final wrongCodeApi = AccountApi(
      client: http_testing.MockClient(
        (_) async =>
            http.Response('{"error":"wrong_code","attempts_left":2}', 422),
      ),
      baseUrl: 'https://relay.example',
    );
    await expectLater(
      wrongCodeApi.checkPasswordResetCode(
        email: 'a@example.com',
        code: '000000',
      ),
      throwsA(
        isA<AccountAuthFailure>()
            .having(
              (failure) => failure.kind,
              'kind',
              AccountAuthFailureKind.wrongCode,
            )
            .having((failure) => failure.attemptsLeft, 'attemptsLeft', 2),
      ),
    );
  });

  test('rejects oversized or malformed session responses', () async {
    final tooLarge = AccountApi(
      client: http_testing.MockClient(
        (_) async => http.Response('x' * (65 * 1024), 200),
      ),
      baseUrl: 'https://relay.example',
    );
    await expectLater(
      tooLarge.signIn(email: 'a@example.com', password: 'password-1234'),
      throwsA(isA<AccountAuthFailure>()),
    );

    final malformed = AccountApi(
      client: http_testing.MockClient((_) async => http.Response('{}', 200)),
      baseUrl: 'https://relay.example',
    );
    await expectLater(
      malformed.signIn(email: 'a@example.com', password: 'password-1234'),
      throwsA(
        isA<AccountAuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AccountAuthFailureKind.invalidResponse,
        ),
      ),
    );
  });

  test('never sends account credentials to a non-local HTTP relay', () async {
    var sent = false;
    final api = AccountApi(
      client: http_testing.MockClient((_) async {
        sent = true;
        return http.Response('{}', 202);
      }),
      baseUrl: 'http://relay.example',
    );

    await expectLater(
      api.signup(email: 'a@example.com', password: 'password-1234'),
      throwsA(
        isA<AccountAuthFailure>().having(
          (failure) => failure.kind,
          'kind',
          AccountAuthFailureKind.unavailable,
        ),
      ),
    );
    expect(sent, isFalse);
  });
}

const _sessionBody =
    '{"account":{"id":"a1","email":"a@example.com",'
    '"pubkey":"pubkey","has_password":true,"google_linked":false},'
    '"nsec":"generated-test-nsec"}';
