import 'dart:io';

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart'
    show FontLoader, MethodChannel, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:buzz/features/pairing/pairing_mobile_page.dart';
import 'package:buzz/features/pairing/pairing_provider.dart';
import 'package:buzz/features/pairing/pairing_qr_scanner.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/theme/theme.dart';

void main() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_W23_PAIRING_SHOTS');
  final output = Directory('/tmp/w23-mobile-pairing-proof')
    ..createSync(recursive: true);

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _screenCases) {
        testWidgets('captures ${screen.name} ${brightness.name} '
            '${size.width.toInt()}x${size.height.toInt()}', (tester) async {
          debugDefaultTargetPlatformOverride = TargetPlatform.android;
          final previousComparator = goldenFileComparator;
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          tester.view.viewPadding = const FakeViewPadding(top: 46, bottom: 20);
          tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
          if (captureScreenshots) {
            goldenFileComparator = LocalFileComparator(
              Uri.file('${output.path}/pairing_test.dart'),
            );
            await _loadProofFonts();
          }
          addTearDown(() {
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.view.viewPadding = FakeViewPadding.zero;
            tester.view.padding = FakeViewPadding.zero;
            goldenFileComparator = previousComparator;
            debugDefaultTargetPlatformOverride = null;
          });

          final rootKey = GlobalKey();
          final child = MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            home: PairingMobilePage(
              initialRoute: screen.route,
              cameraPreviewBuilder: _proofCameraPreview,
            ),
          );
          await tester.pumpWidget(
            ProviderScope(
              overrides: _proofOverrides(screen.route),
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
                              child,
                              _ProofStatusBar(brightness: brightness),
                              _ProofHomeIndicator(brightness: brightness),
                            ],
                          ),
                        ),
                      )
                    : child,
              ),
            ),
          );
          await tester.pumpAndSettle();

          if (captureScreenshots) {
            final filename =
                '${screen.name}-${brightness.name}-'
                '${size.width.toInt()}x${size.height.toInt()}.png';
            await expectLater(find.byKey(rootKey), matchesGoldenFile(filename));
            debugPrint('VISUAL_PROOF ${output.path}/$filename');
          } else {
            expect(find.byKey(rootKey), findsOneWidget);
            expect(find.text(screen.expectedHeading), findsOneWidget);
          }
          debugDefaultTargetPlatformOverride = null;
        });
      }
    }
  }

  testWidgets('manual entry submits the full desktop payload unchanged', (
    tester,
  ) async {
    final notifier = _PairingTestNotifier();
    await tester.pumpWidget(
      _testApp(notifier: notifier, child: const PairingMobilePage()),
    );
    await tester.tap(find.text('Enter a code instead'));
    await tester.pumpAndSettle();
    const code = 'nostrpair://desktop?session=review-only';
    await tester.enterText(find.byType(TextField), code);
    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(notifier.submittedCode, code);
  });

  testWidgets('phone approval moves to waiting while keeping the SAS code', (
    tester,
  ) async {
    final notifier = _PairingTestNotifier(
      initialState: const PairingState(
        status: PairingStatus.confirmingSas,
        sasCode: '483 291',
      ),
    );
    await tester.pumpWidget(
      _testApp(
        notifier: notifier,
        child: const PairingMobilePage(
          initialRoute: PairingMobileRoute.compare,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('483 291'), findsOneWidget);
    await tester.tap(find.text('Yes, the codes match'));
    await tester.pumpAndSettle();

    expect(notifier.state.userConfirmedSas, isTrue);
    expect(find.text('Confirm on your desktop.'), findsOneWidget);
    expect(find.text('483 291'), findsOneWidget);
  });

  testWidgets('Open Colony exits pairing and nested sign in routes', (
    tester,
  ) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _proofOverrides(PairingMobileRoute.success),
        child: MaterialApp(
          navigatorKey: navigatorKey,
          theme: AppTheme.light(),
          home: const Scaffold(body: Center(child: Text('Channels'))),
        ),
      ),
    );
    navigatorKey.currentState!.push<void>(
      MaterialPageRoute<void>(builder: (_) => const _NestedSignInPage()),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pair with my desktop'));
    await tester.pumpAndSettle();
    expect(find.text('You’re connected.'), findsOneWidget);

    await tester.tap(find.text('Open Colony'));
    await tester.pumpAndSettle();

    expect(find.text('Channels'), findsOneWidget);
    expect(find.text('Sign-in host'), findsNothing);
    expect(find.text('You’re connected.'), findsNothing);
  });

  testWidgets('camera permission recovery offers manual entry and settings', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(
        notifier: _PairingTestNotifier(),
        child: const PairingMobilePage(
          initialRoute: PairingMobileRoute.cameraDenied,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Camera access is off.'), findsOneWidget);
    expect(find.text('Enter a code instead'), findsOneWidget);
    expect(find.text('Open camera settings'), findsOneWidget);
  });

  testWidgets('camera settings action uses the native QR scanner channel', (
    tester,
  ) async {
    const channel = MethodChannel('buzz/qr_scanner');
    var called = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          called = call.method == 'openCameraSettings';
          return true;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null),
    );

    expect(await openPairingCameraSettings(), isTrue);
    expect(called, isTrue);
  });
}

final _screenCases = <_ScreenCase>[
  _ScreenCase(
    PairingMobileRoute.start,
    'start',
    'Your Colony.\nOn this phone.',
  ),
  _ScreenCase(PairingMobileRoute.scan, 'scan', 'Scan your desktop.'),
  _ScreenCase(PairingMobileRoute.manual, 'manual', 'Enter the pairing code.'),
  _ScreenCase(
    PairingMobileRoute.cameraDenied,
    'camera-denied',
    'Camera access is off.',
  ),
  _ScreenCase(PairingMobileRoute.compare, 'compare', 'Do the codes match?'),
  _ScreenCase(
    PairingMobileRoute.waiting,
    'waiting',
    'Confirm on your desktop.',
  ),
  _ScreenCase(PairingMobileRoute.success, 'success', 'You’re connected.'),
  _ScreenCase(PairingMobileRoute.failed, 'failed', 'Couldn’t finish pairing.'),
  _ScreenCase(PairingMobileRoute.expired, 'expired', 'This code has expired.'),
  _ScreenCase(PairingMobileRoute.cancelled, 'cancelled', 'Pairing cancelled.'),
  _ScreenCase(
    PairingMobileRoute.mismatch,
    'mismatch',
    'Don’t approve this pairing.',
  ),
];

List<Override> _proofOverrides(PairingMobileRoute route) => [
  pairingProvider.overrideWith(
    () => _PairingTestNotifier(initialState: _proofState(route)),
  ),
  activeCommunityProvider.overrideWith(
    (ref) async => Community(
      id: 'r18-proof',
      name: 'Lerato Social',
      relayUrl: 'wss://relay.example',
      pubkey: _proofPubkey,
      addedAt: DateTime.utc(2026, 9, 26),
    ),
  ),
  userCacheProvider.overrideWith(_ProofUserCache.new),
];

PairingState _proofState(PairingMobileRoute route) => switch (route) {
  PairingMobileRoute.compare => const PairingState(
    status: PairingStatus.confirmingSas,
    sasCode: '483 291',
  ),
  PairingMobileRoute.waiting => const PairingState(
    status: PairingStatus.confirmingSas,
    sasCode: '483 291',
    userConfirmedSas: true,
  ),
  PairingMobileRoute.success => const PairingState(
    status: PairingStatus.success,
  ),
  _ => const PairingState(),
};

Widget _proofCameraPreview(BuildContext context) => const DecoratedBox(
  decoration: BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [Color(0xff38333e), Color(0xff323941)],
    ),
  ),
  child: Center(
    child: Text(
      'QR camera view',
      style: TextStyle(
        color: Color(0xffd2cdd7),
        fontFamily: 'Manrope',
        fontSize: 11,
      ),
    ),
  ),
);

Widget _testApp({
  required _PairingTestNotifier notifier,
  required Widget child,
}) => ProviderScope(
  overrides: [pairingProvider.overrideWith(() => notifier)],
  child: MaterialApp(theme: AppTheme.light(), home: child),
);

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
}

class _ScreenCase {
  const _ScreenCase(this.route, this.name, this.expectedHeading);

  final PairingMobileRoute route;
  final String name;
  final String expectedHeading;
}

class _PairingTestNotifier extends PairingNotifier {
  _PairingTestNotifier({PairingState initialState = const PairingState()})
    : _initialState = initialState;

  final PairingState _initialState;
  String? submittedCode;

  @override
  PairingState build() => _initialState;

  @override
  Future<void> pairExistingIdentity(String rawInput) async {
    submittedCode = rawInput;
  }

  @override
  void confirmSas() {
    state = state.copyWith(userConfirmedSas: true);
  }

  @override
  void denySas() {
    state = state.copyWith(
      status: PairingStatus.error,
      failureKind: PairingFailureKind.mismatch,
    );
  }

  @override
  void cancelPairing() {
    state = state.copyWith(
      status: PairingStatus.error,
      failureKind: PairingFailureKind.cancelled,
    );
  }

  @override
  void reset() {
    submittedCode = null;
    state = const PairingState();
  }
}

class _ProofUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => {
    _proofPubkey: const UserProfile(
      pubkey: _proofPubkey,
      displayName: 'Lerato Molefe',
    ),
  };
}

const _proofPubkey =
    '8a9f5e33778f4ad7cc805b7e748011e258f99a8897f68b5f1b0c6e832e2e1e7d';

class _NestedSignInPage extends StatelessWidget {
  const _NestedSignInPage();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: TextButton(
        onPressed: () => Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const PairingMobilePage(
              initialRoute: PairingMobileRoute.success,
            ),
          ),
        ),
        child: const Text('Pair with my desktop'),
      ),
    ),
  );
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
    bottom: 8,
    left: 0,
    right: 0,
    child: IgnorePointer(
      child: Align(
        alignment: Alignment.center,
        child: Container(
          width: 108,
          height: 4,
          decoration: BoxDecoration(
            color: Color(
              brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
            ),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      ),
    ),
  );
}
