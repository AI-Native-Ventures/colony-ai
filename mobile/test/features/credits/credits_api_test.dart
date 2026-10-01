import 'dart:convert';

import 'package:buzz/features/credits/credits_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:nostr/nostr.dart' as nostr;

void main() {
  test('reads one payment attempt using its existing reference', () async {
    final keys = nostr.Keys.generate();
    late http.Request captured;
    final client = http_testing.MockClient((request) async {
      captured = request;
      return http.Response(
        jsonEncode({
          'reference': 'credit-test-17',
          'status': 'pending',
          'chargeMinorUnits': 2510,
          'paidMinorUnits': null,
          'currency': 'ZAR',
          'grantNanousd': '3450000000',
          'createdAt': '2026-09-30T10:00:00Z',
        }),
        200,
      );
    });
    final api = CreditsApi(
      client: client,
      baseUrl: 'https://relay.example',
      nsec: keys.nsec,
    );

    final intent = await api.readPaymentIntent('credit-test-17');
    client.close();

    expect(captured.method, 'GET');
    expect(
      captured.url.toString(),
      'https://relay.example/api/payments/intents/credit-test-17',
    );
    expect(captured.followRedirects, isFalse);
    expect(captured.headers['Authorization'], startsWith('Nostr '));
    expect(intent.reference, 'credit-test-17');
    expect(intent.status, 'pending');
    expect(intent.amountZarCents, 2510);
    expect(intent.paidZarCents, isNull);
    expect(intent.grantUsdCents, 345);
    expect(intent.grantNanoUsd, BigInt.from(3450000000));
  });

  test(
    'rejects a malformed payment reference before making a request',
    () async {
      var requests = 0;
      final client = http_testing.MockClient((_) async {
        requests++;
        return http.Response('{}', 200);
      });
      final api = CreditsApi(
        client: client,
        baseUrl: 'https://relay.example',
        nsec: 'test-key',
      );

      await expectLater(
        api.readPaymentIntent('../checkout'),
        throwsA(
          isA<CreditsFailure>().having(
            (failure) => failure.kind,
            'kind',
            CreditsFailureKind.invalidResponse,
          ),
        ),
      );
      client.close();

      expect(requests, 0);
    },
  );
}
