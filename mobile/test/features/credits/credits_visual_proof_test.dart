import 'dart:io';
import 'dart:typed_data';

import 'package:buzz/features/credits/credits_api.dart';
import 'package:buzz/features/credits/credits_pages.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_W23_CREDITS_SHOTS');
  if (captureScreenshots) setUpAll(_loadCreditsProofFonts);

  testWidgets('credits unavailable state retries its live source', (
    tester,
  ) async {
    var attempts = 0;
    await tester.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          creditsOverviewProvider.overrideWith((ref) async {
            attempts++;
            throw const CreditsFailure(CreditsFailureKind.unavailable);
          }),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const CreditsBalancePage(communityName: 'Workspace'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Credits'), findsOneWidget);
    expect(find.text('Workspace'), findsOneWidget);
    expect(find.text('Credits could not load'), findsOneWidget);
    expect(
      find.text(
        'The connected source is unavailable. Existing work is kept, and missing data is not shown as zero.',
      ),
      findsOneWidget,
    );
    expect(find.text('Retry connection'), findsOneWidget);
    expect(find.text('USD 0.00'), findsNothing);
    expect(attempts, 1);

    await tester.tap(find.byKey(const ValueKey('credits-retry')));
    await tester.pumpAndSettle();
    expect(attempts, 2);
  });

  if (!captureScreenshots) return;

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      testWidgets(
        'captures credits unavailable ${size.width.toInt()}x${size.height.toInt()} ${brightness.name}',
        (tester) async {
          final oldComparator = goldenFileComparator;
          final oldPlatform = debugDefaultTargetPlatformOverride;
          final output = Directory('/tmp/w23-mobile-credits-proof')
            ..createSync(recursive: true);
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          tester.view.padding = const FakeViewPadding(top: 25, bottom: 20);
          tester.view.viewPadding = const FakeViewPadding(top: 25, bottom: 20);
          debugDefaultTargetPlatformOverride = TargetPlatform.android;
          addTearDown(() {
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.view.viewPadding = FakeViewPadding.zero;
            tester.view.padding = FakeViewPadding.zero;
            goldenFileComparator = oldComparator;
            debugDefaultTargetPlatformOverride = oldPlatform;
          });

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
              child: const CreditsBalancePage(communityName: 'Workspace'),
            ),
          );
          await tester.pumpWidget(
            ProviderScope(
              retry: (_, _) => null,
              overrides: [
                creditsOverviewProvider.overrideWith(
                  (ref) async => throw const CreditsFailure(
                    CreditsFailureKind.unavailable,
                  ),
                ),
              ],
              child: RepaintBoundary(
                key: rootKey,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(36),
                  child: Directionality(
                    textDirection: TextDirection.ltr,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [app, _CreditsProofBars(brightness)],
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();

          final mode = brightness == Brightness.light ? 'light' : 'dark';
          final filename =
              'credits-unavailable-${size.width.toInt()}x${size.height.toInt()}-$mode.png';
          goldenFileComparator = _CreditsCaptureComparator(
            Uri.file('${output.path}/capture_test.dart'),
            output.path,
          );
          await expectLater(find.byKey(rootKey), matchesGoldenFile(filename));
          debugPrint('VISUAL_PROOF ${output.path}/$filename');
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pumpAndSettle();
          goldenFileComparator = oldComparator;
          debugDefaultTargetPlatformOverride = oldPlatform;
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
          tester.view.viewPadding = FakeViewPadding.zero;
          tester.view.padding = FakeViewPadding.zero;
        },
      );
    }
  }
}

Future<void> _loadCreditsProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await lucide.load();
}

class _CreditsCaptureComparator extends LocalFileComparator {
  _CreditsCaptureComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

class _CreditsProofBars extends StatelessWidget {
  const _CreditsProofBars(this.brightness);

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = brightness == Brightness.dark
        ? const Color(0xFFF2E9F6)
        : const Color(0xFF34263C);
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: 35,
            left: 25,
            child: Text(
              '9:41',
              style: TextStyle(
                color: color,
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Positioned(
            top: 35,
            right: 25,
            child: Row(
              children: [
                Icon(Icons.signal_cellular_alt, color: color, size: 14),
                const SizedBox(width: 3),
                Icon(Icons.battery_full, color: color, size: 16),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 7,
            child: Center(
              child: Container(
                width: 108,
                height: 4,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(50),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
