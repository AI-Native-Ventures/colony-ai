import 'dart:io';

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:buzz/features/credits/credits_api.dart';
import 'package:buzz/features/credits/credits_pages.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';

const _reference = 'credits-visual-proof-17';
const _grantNanoUsd = 3450000000;
const _grantUsdCents = 345;
const _chargeZarCents = 2510;

void main() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_B2_CREDITS_SHOTS');
  final output = Directory('/tmp/b2-mobile-credits-proof')
    ..createSync(recursive: true);

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final state in _paymentStates) {
        testWidgets('captures credits-${state.name} ${brightness.name} '
            '${size.width.toInt()}x${size.height.toInt()}', (tester) async {
          debugDefaultTargetPlatformOverride = TargetPlatform.android;
          final previousComparator = goldenFileComparator;
          if (captureScreenshots) {
            goldenFileComparator = LocalFileComparator(
              Uri.file('${output.path}/proof_test.dart'),
            );
            tester.view.viewPadding = const FakeViewPadding(
              top: 25,
              bottom: 20,
            );
            tester.view.padding = const FakeViewPadding(top: 25, bottom: 20);
          }
          addTearDown(() {
            debugDefaultTargetPlatformOverride = null;
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.view.viewPadding = FakeViewPadding.zero;
            tester.view.padding = FakeViewPadding.zero;
            goldenFileComparator = previousComparator;
          });
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          if (captureScreenshots) await _loadProofFonts();

          final rootKey = GlobalKey();
          final app = MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            home: MobileShell(
              destination: MobileShellDestination.company,
              onDestinationSelected: (_) {},
              showBrandBar: false,
              child: CreditsPaymentStatusPage(
                reference: _reference,
                isBrowserReturn: state.isBrowserReturn,
              ),
            ),
          );

          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                activeCommunityProvider.overrideWith(
                  (_) async => Community.create(
                    name: 'Proof workspace',
                    relayUrl: 'wss://relay.example',
                  ),
                ),
                creditsPaymentIntentProvider(_reference).overrideWith((
                  _,
                ) async {
                  if (state.unavailable) {
                    throw StateError('Status service unavailable');
                  }
                  return _payment(state.status);
                }),
                creditsOverviewProvider.overrideWith((_) async {
                  return _overview(
                    ledger: state.confirmed
                        ? [
                            CreditsLedgerEntry(
                              id: 'ledger-visual-proof-17',
                              type: 'purchase',
                              amountNanoUsd: BigInt.from(_grantNanoUsd),
                              amountUsdCents: _grantUsdCents,
                              description: 'Test purchase',
                              reference: _reference,
                              createdAt: DateTime.utc(2026, 9, 30),
                            ),
                          ]
                        : const [],
                  );
                }),
              ],
              child: RepaintBoundary(
                key: rootKey,
                child: captureScreenshots
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(36),
                        child: Directionality(
                          textDirection: TextDirection.ltr,
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              app,
                              _ProofStatusBar(brightness: brightness),
                              _ProofHomeIndicator(brightness: brightness),
                            ],
                          ),
                        ),
                      )
                    : app,
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.pump(const Duration(milliseconds: 450));

          if (captureScreenshots) {
            final filename =
                'credits-${state.name}-${brightness.name}-'
                '${size.width.toInt()}x${size.height.toInt()}.png';
            await expectLater(find.byKey(rootKey), matchesGoldenFile(filename));
            debugPrint('VISUAL_PROOF ${output.path}/$filename');
          } else {
            expect(find.byKey(rootKey), findsOneWidget);
          }
          debugDefaultTargetPlatformOverride = null;
        });
      }
    }
  }
}

final _paymentStates = <_PaymentState>[
  const _PaymentState(name: 'pending', status: 'pending'),
  const _PaymentState(name: 'return', status: 'pending', isBrowserReturn: true),
  const _PaymentState(name: 'failed', status: 'failed'),
  const _PaymentState(name: 'cancelled', status: 'cancelled'),
  const _PaymentState(name: 'paid', status: 'paid', confirmed: true),
  const _PaymentState(
    name: 'unavailable',
    status: 'pending',
    unavailable: true,
  ),
];

class _PaymentState {
  const _PaymentState({
    required this.name,
    required this.status,
    this.confirmed = false,
    this.unavailable = false,
    this.isBrowserReturn = false,
  });

  final String name;
  final String status;
  final bool confirmed;
  final bool unavailable;
  final bool isBrowserReturn;
}

CreditsPaymentIntent _payment(String status) => CreditsPaymentIntent(
  reference: _reference,
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
  packId: 'starter',
  amountZarCents: _chargeZarCents,
  paidZarCents: status == 'paid' ? _chargeZarCents : null,
  grantNanoUsd: BigInt.from(_grantNanoUsd),
  grantUsdCents: _grantUsdCents,
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

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final icons = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await icons.load();
}

class _ProofStatusBar extends StatelessWidget {
  const _ProofStatusBar({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = Color(
      brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
    );
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: SizedBox(
          height: 46,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(25, 8, 25, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '9:41',
                  style: TextStyle(
                    color: color,
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Icon(Icons.signal_cellular_alt, color: color, size: 14),
                    const SizedBox(width: 3),
                    Icon(Icons.battery_full, color: color, size: 16),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProofHomeIndicator extends StatelessWidget {
  const _ProofHomeIndicator({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) => Positioned(
    left: 0,
    right: 0,
    bottom: 8,
    child: IgnorePointer(
      child: Center(
        child: Container(
          width: 108,
          height: 4,
          decoration: BoxDecoration(
            color: brightness == Brightness.dark
                ? const Color(0xffeee8f0)
                : const Color(0xff292632),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
    ),
  );
}
