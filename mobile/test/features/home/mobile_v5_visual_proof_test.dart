import 'dart:io';

import 'package:buzz/features/home/company_hub_page.dart';
import 'package:buzz/features/home/home_page.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  const capture = bool.fromEnvironment('CAPTURE_MOBILE_V5_COMPANY');
  const sizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};

  for (final size in sizes.entries) {
    for (final brightness in Brightness.values) {
      testWidgets('captures Company hub ${brightness.name} ${size.key}', (
        tester,
      ) async {
        if (!capture) return;

        tester.view
          ..physicalSize = size.value
          ..devicePixelRatio = 1
          ..viewPadding = const FakeViewPadding(top: 25, bottom: 20)
          ..padding = const FakeViewPadding(top: 25, bottom: 20);
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
          tester.view.resetViewPadding();
          tester.view.resetPadding();
        });

        await _loadProofFonts();
        final rootKey = GlobalKey();
        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              theme: brightness == Brightness.light
                  ? AppTheme.light()
                  : AppTheme.dark(),
              home: RepaintBoundary(
                key: rootKey,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    HomePage(
                      routeRegistry: _routes(),
                      settingsPageBuilder: (_) => const SizedBox.shrink(),
                      hasUnreadInbox: false,
                    ),
                    Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 25,
                      child: const _ProofStatusBar(),
                    ),
                    Positioned(
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 20,
                      child: _ProofHomeIndicator(brightness: brightness),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.byKey(const ValueKey('mobile-nav-company')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        final mode = brightness == Brightness.light ? 'light' : 'dark';
        const outputPath = '/tmp/m-v5-visual-sheets';
        Directory(outputPath).createSync(recursive: true);
        final previousComparator = goldenFileComparator;
        goldenFileComparator = LocalFileComparator(
          Uri.file('$outputPath/golden_test.dart'),
        );
        addTearDown(() => goldenFileComparator = previousComparator);
        final fileName = 'company-${size.key}-$mode.png';
        await expectLater(find.byKey(rootKey), matchesGoldenFile(fileName));
        expect(tester.takeException(), isNull);
        debugPrint('VISUAL_PROOF $outputPath/$fileName');
      });
    }
  }
}

MobileRouteRegistry _routes() {
  late final MobileRouteRegistry routes;
  routes = MobileRouteRegistry.empty()
      .register(MobileRoutes.today, (_, _) => const SizedBox.expand())
      .register(MobileRoutes.chats, (_, _) => const SizedBox.expand())
      .register(MobileRoutes.activity, (_, _) => const SizedBox.expand())
      .register(
        MobileRoutes.business,
        (_, _) => CompanyHubPage(
          routeRegistry: routes,
          settingsPageBuilder: (_) => const SizedBox.shrink(),
          companyName: 'Lerato Social',
          identityInitials: 'LM',
          identityLabel: 'Lerato Molefe',
          onOpenQuickActions: _ignoreQuickActions,
        ),
      )
      .register(MobileRoutes.search, (_, _) => const SizedBox.shrink())
      .register(MobileRoutes.updates, (_, _) => const SizedBox.shrink())
      .register(MobileBusinessRoutes.team, (_, _) => const SizedBox.shrink())
      .register(MobileBusinessRoutes.goals, (_, _) => const SizedBox.shrink())
      .register(MobileBusinessRoutes.work, (_, _) => const SizedBox.shrink())
      .register(
        MobileBusinessRoutes.workflows,
        (_, _) => const SizedBox.shrink(),
      )
      .register(
        MobileBusinessRoutes.discovery,
        (_, _) => const SizedBox.shrink(),
      )
      .register(MobileBusinessRoutes.social, (_, _) => const SizedBox.shrink())
      .register(MobileBusinessRoutes.website, (_, _) => const SizedBox.shrink())
      .register(MobileBusinessRoutes.money, (_, _) => const SizedBox.shrink());
  return routes;
}

Future<void> _loadProofFonts() async {
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
  const _ProofStatusBar();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ColoredBox(
      color: tokens.canvas,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '9:41',
              style: context.mobileTypography.identityStatus.copyWith(
                color: tokens.ink,
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(
              '••• ▰',
              style: context.mobileTypography.identityStatus.copyWith(
                color: tokens.ink,
                letterSpacing: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProofHomeIndicator extends StatelessWidget {
  const _ProofHomeIndicator({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Align(
      alignment: Alignment.center,
      child: SizedBox(
        width: 108,
        height: 4,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: brightness == Brightness.light ? tokens.ink : tokens.paper,
            borderRadius: BorderRadius.circular(Radii.full),
          ),
        ),
      ),
    );
  }
}

void _ignoreQuickActions() {}
