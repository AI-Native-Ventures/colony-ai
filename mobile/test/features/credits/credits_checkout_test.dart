import 'package:buzz/features/credits/credits_api.dart';
import 'package:buzz/features/credits/credits_pages.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/testing.dart' as http_testing;

const _existingReference = 'credit-existing-18';
const _existingIdempotencyKey = '123e4567-e89b-42d3-a456-426614174001';
const _packId = 'starter';

void main() {
  testWidgets('checkout resumes the existing pending attempt by its key', (
    tester,
  ) async {
    final api = _TrackingCreditsApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [creditsApiProvider.overrideWithValue(api)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: CreditsQuotePage(
            pack: CreditsPack(
              id: _packId,
              name: 'Starter',
              chargeZarCents: 11900,
              grantNanoUsd: BigInt.from(5000000000),
              grantUsdCents: 500,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('credits-continue-to-payfast')));

    final handoffPage = find.byType(CreditsPaymentHandoffPage);
    for (var frame = 0; frame < 20 && handoffPage.evaluate().isEmpty; frame++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(handoffPage, findsOneWidget);
    expect(api.checkoutIdempotencyKeys, hasLength(2));
    expect(api.checkoutPackIds, [_packId, _packId]);
    expect(api.checkoutIdempotencyKeys.first, isNot(_existingIdempotencyKey));
    expect(api.checkoutIdempotencyKeys.last, _existingIdempotencyKey);
    expect(api.readReferences, [_existingReference]);
    final handoff = tester.widget<CreditsPaymentHandoffPage>(handoffPage);
    expect(handoff.checkout.reference, _existingReference);
    expect(handoff.checkout.idempotencyKey, _existingIdempotencyKey);
  });
}

class _TrackingCreditsApi extends CreditsApi {
  _TrackingCreditsApi()
    : super(
        client: http_testing.MockClient((_) async {
          throw StateError('The fake API does not send HTTP requests.');
        }),
        baseUrl: 'https://relay.example',
        nsec: null,
      );

  final checkoutIdempotencyKeys = <String>[];
  final checkoutPackIds = <String>[];
  final readReferences = <String>[];

  @override
  Future<CreditsCheckout> createCheckout({
    required String packId,
    required String idempotencyKey,
  }) async {
    checkoutPackIds.add(packId);
    checkoutIdempotencyKeys.add(idempotencyKey);
    if (checkoutIdempotencyKeys.length == 1) {
      throw const CreditsFailure(
        CreditsFailureKind.openIntent,
        reference: _existingReference,
        status: 'pending',
      );
    }
    return CreditsCheckout(
      reference: _existingReference,
      packId: _packId,
      idempotencyKey: _existingIdempotencyKey,
      status: 'pending',
      amountZarCents: 11900,
      grantNanoUsd: BigInt.from(5000000000),
      grantUsdCents: 500,
      sandbox: true,
      authorizationUrl: 'https://sandbox.payfast.co.za/eng/process',
      authorizationMethod: 'POST',
      authorizationFields: const [
        CreditsFormField(name: 'merchant_id', value: 'merchant-public'),
        CreditsFormField(name: 'signature', value: 'signed-form-value'),
      ],
    );
  }

  @override
  Future<CreditsPaymentIntent> readPaymentIntent(String reference) async {
    readReferences.add(reference);
    return CreditsPaymentIntent(
      reference: _existingReference,
      idempotencyKey: _existingIdempotencyKey,
      packId: _packId,
      amountZarCents: 11900,
      paidZarCents: null,
      grantNanoUsd: BigInt.from(5000000000),
      grantUsdCents: 500,
      status: 'pending',
      createdAt: _testCreatedAt,
    );
  }
}

final _testCreatedAt = DateTime.utc(2026, 9, 30);
