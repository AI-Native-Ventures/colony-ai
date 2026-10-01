import 'package:buzz/features/credits/credits_api.dart';
import 'package:buzz/features/credits/credits_pages.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _reference = 'credit-test-17';
const _grantNanoUsd = 3450000000;

void main() {
  testWidgets('a paid payment record stays pending without its ledger entry', (
    tester,
  ) async {
    await _pump(
      tester,
      payment: _payment('paid', paidZarCents: 2510),
      overview: _overview(),
    );

    expect(find.text('Still waiting for confirmation.'), findsOneWidget);
    expect(
      find.text('Your browser return is not proof of payment.'),
      findsOneWidget,
    );
    expect(find.text('Credits have not been added yet'), findsOneWidget);
    expect(find.text('You’re topped up.'), findsNothing);
    expect(find.text('USD 3.45'), findsOneWidget);
    expect(find.text('ZAR 25.10'), findsOneWidget);
  });

  testWidgets('failed attempt offers a retry after its terminal status', (
    tester,
  ) async {
    await _pump(tester, payment: _payment('failed'), overview: _overview());

    expect(find.text('Payment failed'), findsOneWidget);
    expect(find.text('Payfast'), findsOneWidget);
    expect(find.text('Retry this payment'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Payment failed')).dy,
      greaterThan(tester.getTopLeft(find.text('Payfast')).dy),
    );
  });

  testWidgets('paid is confirmed only by its matching purchase ledger row', (
    tester,
  ) async {
    await _pump(
      tester,
      payment: _payment('paid', paidZarCents: 2510),
      overview: _overview(
        ledger: [
          CreditsLedgerEntry(
            id: 'ledger-test-17',
            type: 'purchase',
            amountNanoUsd: BigInt.from(_grantNanoUsd),
            amountUsdCents: 345,
            description: 'Test purchase',
            reference: _reference,
            createdAt: DateTime.utc(2026, 9, 30),
          ),
        ],
      ),
    );

    expect(find.text('You’re topped up.'), findsOneWidget);
    expect(
      find.text('The payment record and credit ledger agree.'),
      findsOneWidget,
    );
    expect(find.text('Confirmed'), findsOneWidget);
    expect(find.text('USD 3.45'), findsOneWidget);
    expect(find.text('ZAR 25.10'), findsOneWidget);
  });

  testWidgets('status retry checks the same existing payment reference', (
    tester,
  ) async {
    var intentReads = 0;
    var overviewReads = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeCommunityProvider.overrideWith((_) async => null),
          creditsPaymentIntentProvider(_reference).overrideWith((_) async {
            intentReads++;
            return _payment('pending');
          }),
          creditsOverviewProvider.overrideWith((_) async {
            overviewReads++;
            return _overview();
          }),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const CreditsPaymentStatusPage(reference: _reference),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Check payment status'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('credits-payment-status-check')),
    );
    await tester.pumpAndSettle();

    expect(intentReads, 2);
    expect(overviewReads, 2);
    expect(find.text('Still waiting for confirmation.'), findsOneWidget);
  });

  testWidgets('browser return checks status before showing the pending state', (
    tester,
  ) async {
    var intentReads = 0;
    var overviewReads = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeCommunityProvider.overrideWith((_) async => null),
          creditsPaymentIntentProvider(_reference).overrideWith((_) async {
            intentReads++;
            return _payment('pending');
          }),
          creditsOverviewProvider.overrideWith((_) async {
            overviewReads++;
            return _overview();
          }),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const CreditsPaymentStatusPage(
            reference: _reference,
            isBrowserReturn: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Welcome back.'), findsOneWidget);
    expect(find.text('Still waiting for confirmation.'), findsNothing);
    await tester.tap(
      find.byKey(const ValueKey('credits-payment-status-check')),
    );
    await tester.pumpAndSettle();

    expect(intentReads, 2);
    expect(overviewReads, 2);
    expect(find.text('Welcome back.'), findsNothing);
    expect(find.text('Still waiting for confirmation.'), findsOneWidget);
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required CreditsPaymentIntent payment,
  required CreditsOverview overview,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        activeCommunityProvider.overrideWith((_) async => null),
        creditsPaymentIntentProvider(
          _reference,
        ).overrideWith((_) async => payment),
        creditsOverviewProvider.overrideWith((_) async => overview),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const CreditsPaymentStatusPage(reference: _reference),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

CreditsPaymentIntent _payment(String status, {int? paidZarCents}) =>
    CreditsPaymentIntent(
      reference: _reference,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      packId: 'starter',
      amountZarCents: 2510,
      paidZarCents: paidZarCents,
      grantNanoUsd: BigInt.from(_grantNanoUsd),
      grantUsdCents: 345,
      status: status,
      createdAt: DateTime.utc(2026, 9, 30),
    );

CreditsOverview _overview({List<CreditsLedgerEntry> ledger = const []}) =>
    CreditsOverview(
      balanceUsdCents: 0,
      currentMonth: const CreditsUsageMonth(
        month: '2026-09',
        spentUsdCents: 0,
        entryCount: 0,
      ),
      months: const [],
      ledger: ledger,
      paymentIntents: [_payment('pending')],
    );
