import 'dart:async';

import 'package:buzz/features/home/home_page.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/navigation/mobile_navigation.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_context.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

MobileRouteRegistry buildTestRoutes({
  MobileRouteBuilder<MobileShellRouteContext>? todayBuilder,
  MobileRouteBuilder<MobileShellRouteContext>? chatBuilder,
  MobileRouteBuilder<MobileShellRouteContext>? companyBuilder,
  MobileRouteBuilder<NoMobileRouteArguments>? searchBuilder,
}) => MobileRouteRegistry.empty()
    .register(
      MobileRoutes.today,
      todayBuilder ??
          ((BuildContext _, MobileShellRouteContext context) =>
              _DestinationPage('Today', context)),
    )
    .register(
      MobileRoutes.chats,
      chatBuilder ??
          ((BuildContext _, MobileShellRouteContext context) =>
              _DestinationPage('Chats', context)),
    )
    .register(
      MobileRoutes.activity,
      (_, context) => _DestinationPage('Activity', context),
    )
    .register(
      MobileRoutes.business,
      companyBuilder ??
          ((BuildContext _, MobileShellRouteContext context) =>
              _DestinationPage('Company', context)),
    )
    .register(
      MobileRoutes.search,
      searchBuilder ?? (_, _) => const Text('Search route'),
    )
    .register(MobileRoutes.updates, (_, _) => const Text('Updates route'));

Widget buildHome({
  required MobileRouteRegistry routes,
  bool unreadActivity = false,
  Brightness brightness = Brightness.light,
}) => ProviderScope(
  child: MaterialApp(
    theme: brightness == Brightness.light
        ? AppTheme.light(mobileTokens: MobileDesignTokens.light)
        : AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
    home: RepaintBoundary(
      key: const ValueKey('mobile-shell-capture'),
      child: HomePage(
        routeRegistry: routes,
        settingsPageBuilder: (_) => const Text('Settings route'),
        hasUnreadInbox: unreadActivity,
      ),
    ),
  ),
);

Widget buildShellCapture({
  required MobileShellDestination destination,
  required Brightness brightness,
}) {
  final tokens = brightness == Brightness.light
      ? MobileDesignTokens.light
      : MobileDesignTokens.dark;
  return MaterialApp(
    theme: brightness == Brightness.light
        ? AppTheme.light(mobileTokens: tokens)
        : AppTheme.dark(mobileTokens: tokens),
    home: RepaintBoundary(
      key: const ValueKey('mobile-shell-capture'),
      child: MobileShell(
        destination: destination,
        onDestinationSelected: (_) {},
        showBrandBar: false,
        child: ColoredBox(color: tokens.canvas),
      ),
    ),
  );
}

void main() {
  test('exposes only the approved route-backed Company destinations', () {
    expect(MobileBusinessSection.values.map((section) => section.label), [
      'Run the company',
      'Grow the business',
    ]);
    expect(MobileBusinessEntryPoints.all.map((entry) => entry.route.path), [
      'team',
      'goals',
      'work',
      'workflows',
      'business/discovery',
      'business/money',
    ]);
  });

  testWidgets('renders three primary destinations and marks the selection', (
    tester,
  ) async {
    await tester.pumpWidget(
      buildHome(routes: buildTestRoutes(), unreadActivity: true),
    );

    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );
    expect(
      tester.widget<Semantics>(find.byKey(const ValueKey('mobile-nav-today'))),
      isA<Semantics>()
          .having(
            (semantics) => semantics.properties.label,
            'label',
            'Today, unread',
          )
          .having((semantics) => semantics.properties.onTap, 'onTap', isNotNull)
          .having(
            (semantics) => semantics.properties.selected,
            'selected',
            isTrue,
          ),
    );
    expect(
      tester
          .widget<Semantics>(find.byKey(const ValueKey('mobile-nav-chat')))
          .properties
          .label,
      'Chat',
    );
    expect(
      tester
          .widget<Semantics>(find.byKey(const ValueKey('mobile-nav-company')))
          .properties
          .label,
      'Company',
    );
    expect(
      tester
          .widget<Semantics>(find.byKey(const ValueKey('mobile-nav-today')))
          .properties
          .label,
      'Today, unread',
    );
    expect(find.text('Today route 0'), findsOneWidget);
  });

  testWidgets('switches destinations and signals selected-tab reselection', (
    tester,
  ) async {
    await tester.pumpWidget(buildHome(routes: buildTestRoutes()));

    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pumpAndSettle();
    expect(find.text('Chats route 0'), findsOneWidget);
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('mobile-nav-company')));
    await tester.pumpAndSettle();
    expect(find.text('Company route 0'), findsOneWidget);
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pumpAndSettle();
    expect(find.text('Chats route 0'), findsOneWidget);
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pump();
    expect(find.text('Chats route 1'), findsOneWidget);
  });

  testWidgets('gives selection haptics only when the destination changes', (
    tester,
  ) async {
    final hapticCalls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'HapticFeedback.vibrate') hapticCalls.add(call);
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );

    await tester.pumpWidget(buildHome(routes: buildTestRoutes()));
    await tester.tap(find.byKey(const ValueKey('mobile-nav-today')));
    await tester.pump();
    expect(hapticCalls, isEmpty);

    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pump();
    expect(hapticCalls, hasLength(1));
    expect(hapticCalls.single.arguments, 'HapticFeedbackType.selectionClick');

    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pump();
    expect(hapticCalls, hasLength(1));

    await tester.tap(find.byKey(const ValueKey('mobile-nav-company')));
    await tester.pump();
    expect(hapticCalls, hasLength(2));
  });

  testWidgets('keeps Activity reachable from Today and pops back to Today', (
    tester,
  ) async {
    final routes = buildTestRoutes(
      todayBuilder: (_, routeContext) => Builder(
        builder: (context) => TextButton(
          onPressed: () =>
              unawaited(MobileNavigation.openActivity(context, routeContext)),
          child: const Text('Open Activity'),
        ),
      ),
    );

    await tester.pumpWidget(buildHome(routes: routes));
    await tester.tap(find.text('Open Activity'));
    await tester.pumpAndSettle();

    expect(find.text('Activity route 0'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('Open Activity'), findsOneWidget);
    expect(find.text('Activity route 0'), findsNothing);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );
  });

  testWidgets('keeps Search callable through the shared route scope', (
    tester,
  ) async {
    final routes = buildTestRoutes(
      todayBuilder: (_, _) => Builder(
        builder: (context) => TextButton(
          onPressed: () => MobileNavigation.openSearch(context),
          child: const Text('Open search'),
        ),
      ),
    );

    await tester.pumpWidget(buildHome(routes: routes));
    await tester.tap(find.text('Open search'));
    await tester.pumpAndSettle();

    expect(find.text('Search route'), findsOneWidget);
  });

  testWidgets('keeps Updates callable through the shared route scope', (
    tester,
  ) async {
    final routes = buildTestRoutes(
      todayBuilder: (_, _) => Builder(
        builder: (context) => TextButton(
          onPressed: () => MobileNavigation.openUpdates(context),
          child: const Text('Open updates'),
        ),
      ),
    );

    await tester.pumpWidget(buildHome(routes: routes));
    await tester.tap(find.text('Open updates'));
    await tester.pumpAndSettle();

    expect(find.text('Updates route'), findsOneWidget);
  });

  testWidgets('retains route scope inside a pushed route', (tester) async {
    final routes = buildTestRoutes(
      todayBuilder: (_, _) => Builder(
        builder: (context) => TextButton(
          onPressed: () => MobileNavigation.openSearch(context),
          child: const Text('Open search'),
        ),
      ),
      searchBuilder: (_, _) => Builder(
        builder: (context) => TextButton(
          onPressed: () => MobileNavigation.openUpdates(context),
          child: const Text('Open updates from search'),
        ),
      ),
    );

    await tester.pumpWidget(buildHome(routes: routes));
    await tester.tap(find.text('Open search'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open updates from search'));
    await tester.pumpAndSettle();

    expect(find.text('Updates route'), findsOneWidget);
  });

  testWidgets('keeps tab routes inside the shell and handles back locally', (
    tester,
  ) async {
    final routes = buildTestRoutes(
      chatBuilder: (_, _) => Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => const Center(child: Text('Channel detail')),
            ),
          ),
          child: const Text('Open channel'),
        ),
      ),
    );

    await tester.pumpWidget(buildHome(routes: routes));
    await tester.tap(find.byKey(const ValueKey('mobile-nav-chat')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open channel'));
    await tester.pumpAndSettle();

    expect(find.text('Channel detail'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('Open channel'), findsOneWidget);
    expect(find.text('Channel detail'), findsNothing);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);
  });

  testWidgets('builds a shell at the requested mobile viewport', (
    tester,
  ) async {
    const captureScreenshots = bool.fromEnvironment(
      'CAPTURE_MOBILE_SHELL_SHOTS',
    );
    const captureSizeName = String.fromEnvironment(
      'CAPTURE_MOBILE_SIZE',
      defaultValue: '390x844',
    );
    const destinationName = String.fromEnvironment(
      'CAPTURE_MOBILE_DESTINATION',
      defaultValue: 'today',
    );
    const captureDark = bool.fromEnvironment('CAPTURE_MOBILE_DARK');
    const captureSizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};
    final captureSize = captureSizes[captureSizeName];
    if (captureSize == null) {
      throw ArgumentError.value(captureSizeName, 'CAPTURE_MOBILE_SIZE');
    }
    final destination = MobileShellDestination.values.firstWhere(
      (value) => value.name == destinationName,
      orElse: () => throw ArgumentError.value(
        destinationName,
        'CAPTURE_MOBILE_DESTINATION',
      ),
    );
    final brightness = captureDark ? Brightness.dark : Brightness.light;
    final sizeName =
        '${captureSize.width.toInt()}x${captureSize.height.toInt()}';
    final modeName = captureDark ? 'dark' : 'light';
    final outputPath = '/tmp/colony-mobile-shell/$sizeName/$modeName';
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    tester.view.physicalSize = captureSize;
    tester.view.devicePixelRatio = 1;
    if (captureScreenshots) {
      final fontLoader = FontLoader('Manrope')
        ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
      await fontLoader.load();
      final iconFontLoader = FontLoader('packages/lucide_icons_flutter/Lucide')
        ..addFont(
          rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
        );
      await iconFontLoader.load();
    }
    await tester.pumpWidget(
      buildShellCapture(destination: destination, brightness: brightness),
    );
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);
    expect(
      tester
          .getSize(find.byKey(const ValueKey('mobile-bottom-navigation')))
          .height,
      MobileShell.navigationBarHeight,
    );
    if (captureScreenshots) {
      final previousComparator = goldenFileComparator;
      goldenFileComparator = LocalFileComparator(
        Uri.file('$outputPath/golden_test.dart'),
      );
      addTearDown(() => goldenFileComparator = previousComparator);
      await expectLater(
        find.byKey(const ValueKey('mobile-shell-capture')),
        matchesGoldenFile('${destination.name}.png'),
      );
      debugPrint('Captured $outputPath/${destination.name}.png');
    }
  });

  testWidgets('keeps the tabs above the phone bottom safe area', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(bottom: 34);
    addTearDown(() {
      tester.view.resetPadding();
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(buildHome(routes: buildTestRoutes()));

    final navigationRect = tester.getRect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
    );
    expect(navigationRect.top, 844 - 34 - MobileShell.navigationBarHeight);
    expect(navigationRect.bottom, 844);
    expect(
      tester.getRect(find.byKey(const ValueKey('mobile-nav-chat'))).bottom,
      lessThanOrEqualTo(844 - 34),
    );
  });
}

class _DestinationPage extends StatelessWidget {
  const _DestinationPage(this.name, this.routeContext);

  final String name;
  final MobileShellRouteContext routeContext;

  @override
  Widget build(BuildContext context) => Center(
    child: ValueListenableBuilder<int>(
      valueListenable: routeContext.tabReselection,
      builder: (_, reselections, _) => Text('$name route $reselections'),
    ),
  );
}
