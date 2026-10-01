import 'dart:convert';

import 'package:buzz/features/credits/credits_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:nostr/nostr.dart' as nostr;

void main() {
  test(
    'loads the server priced pack catalog without account credentials',
    () async {
      late http.Request captured;
      final client = http_testing.MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'provider': 'payfast',
            'currency': 'ZAR',
            'sandbox': true,
            'enabled': true,
            'packs': [
              {
                'id': 'starter',
                'name': 'Starter',
                'chargeMinorUnits': 11900,
                'chargeCurrency': 'ZAR',
                'grantNanousd': '5000000000',
              },
            ],
          }),
          200,
        );
      });
      final api = CreditsApi(
        client: client,
        baseUrl: 'https://relay.example',
        nsec: null,
      );

      final catalog = await api.loadPackCatalog();
      client.close();

      expect(captured.method, 'GET');
      expect(captured.url.path, '/api/payments/packs');
      expect(captured.headers.containsKey('Authorization'), isFalse);
      expect(catalog.enabled, isTrue);
      expect(catalog.sandbox, isTrue);
      expect(catalog.packs.single.id, 'starter');
      expect(catalog.packs.single.chargeZarCents, 11900);
      expect(catalog.packs.single.grantUsdCents, 500);
    },
  );

  test(
    'submits a signed checkout request and parses ordered form fields',
    () async {
      final keys = nostr.Keys.generate();
      late http.Request captured;
      final client = http_testing.MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'reference': 'credit-test-18',
            'packId': 'starter',
            'status': 'pending',
            'idempotencyKey': '123e4567-e89b-42d3-a456-426614174000',
            'amountMinorUnits': 11900,
            'currency': 'ZAR',
            'grantNanousd': '5000000000',
            'sandbox': true,
            'authorizationUrl': 'https://sandbox.payfast.co.za/eng/process',
            'authorizationMethod': 'POST',
            'authorizationFields': [
              {'name': 'merchant_id', 'value': 'merchant-public'},
              {'name': 'signature', 'value': 'signed-form-value'},
            ],
          }),
          200,
        );
      });
      final api = CreditsApi(
        client: client,
        baseUrl: 'https://relay.example',
        nsec: keys.nsec,
      );

      final checkout = await api.createCheckout(
        packId: 'starter',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      );
      client.close();

      expect(captured.method, 'POST');
      expect(captured.url.path, '/api/payments/checkout');
      expect(captured.followRedirects, isFalse);
      expect(captured.headers['Authorization'], startsWith('Nostr '));
      expect(jsonDecode(captured.body), {
        'packId': 'starter',
        'idempotencyKey': '123e4567-e89b-42d3-a456-426614174000',
      });
      expect(checkout.reference, 'credit-test-18');
      expect(checkout.amountZarCents, 11900);
      expect(checkout.grantUsdCents, 500);
      expect(checkout.authorizationMethod, 'POST');
      expect(checkout.authorizationFields.map((field) => field.name), [
        'merchant_id',
        'signature',
      ]);
    },
  );

  test('surfaces the server reference for an already open payment', () async {
    final keys = nostr.Keys.generate();
    final client = http_testing.MockClient((_) async {
      return http.Response(
        jsonEncode({
          'error': 'payment_pending',
          'reference': 'credit-existing-1',
          'status': 'pending',
        }),
        409,
      );
    });
    final api = CreditsApi(
      client: client,
      baseUrl: 'https://relay.example',
      nsec: keys.nsec,
    );

    await expectLater(
      api.createCheckout(
        packId: 'starter',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      ),
      throwsA(
        isA<CreditsFailure>()
            .having(
              (failure) => failure.kind,
              'kind',
              CreditsFailureKind.openIntent,
            )
            .having(
              (failure) => failure.reference,
              'reference',
              'credit-existing-1',
            ),
      ),
    );
    client.close();
  });

  test('reads one payment attempt using its existing reference', () async {
    final keys = nostr.Keys.generate();
    late http.Request captured;
    final client = http_testing.MockClient((request) async {
      captured = request;
      return http.Response(
        jsonEncode({
          'reference': 'credit-test-17',
          'idempotencyKey': '123e4567-e89b-42d3-a456-426614174000',
          'packId': 'starter',
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
