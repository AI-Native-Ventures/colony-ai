import 'package:buzz/features/home/company_hub_page.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

Widget _companyApp(
  MobileRouteRegistry registry, {
  VoidCallback onOpenQuickActions = _ignoreQuickActions,
}) => ProviderScope(
  child: MaterialApp(
    theme: AppTheme.light(),
    home: MobileRouteScope(
      registry: registry,
      child: CompanyHubPage(
        routeRegistry: registry,
        settingsPageBuilder: (_) => const Text('Settings route'),
        companyName: 'Lerato Social',
        identityInitials: 'LM',
        identityLabel: 'Lerato Molefe',
        onOpenQuickActions: onOpenQuickActions,
      ),
    ),
  ),
);

void main() {
  testWidgets('shows only Company destinations with registered routes', (
    tester,
  ) async {
    final routes = MobileRouteRegistry.empty()
        .register(MobileBusinessRoutes.team, (_, _) => const Text('Team route'))
        .register(
          MobileBusinessRoutes.goals,
          (_, _) => const Text('Goals route'),
        )
        .register(
          MobileBusinessRoutes.discovery,
          (_, _) => const Text('Discovery route'),
        );

    await tester.pumpWidget(_companyApp(routes));

    expect(find.text('Your company'), findsOneWidget);
    expect(find.text('Lerato Social'), findsOneWidget);
    expect(find.text('LM'), findsOneWidget);
    expect(find.text('RUN THE COMPANY'), findsOneWidget);
    expect(find.text('Team'), findsOneWidget);
    expect(find.text('Goals'), findsOneWidget);
    expect(find.text('People & agents'), findsOneWidget);
    expect(find.text('GROW THE BUSINESS'), findsOneWidget);
    expect(find.text('Discovery'), findsOneWidget);
    expect(find.text('Work'), findsNothing);
    expect(find.text('Workflows'), findsNothing);
    expect(find.text('Social'), findsNothing);
    expect(find.text('Website'), findsNothing);
    expect(find.text('Money'), findsNothing);

    await tester.tap(find.text('Goals'));
    await tester.pumpAndSettle();
    expect(find.text('Goals route'), findsOneWidget);
  });

  testWidgets('opens a registered Team destination', (tester) async {
    final routes = MobileRouteRegistry.empty().register(
      MobileBusinessRoutes.team,
      (_, _) => const Text('Team route'),
    );
    await tester.pumpWidget(_companyApp(routes));

    await tester.tap(find.text('Team'));
    await tester.pumpAndSettle();
    expect(find.text('Team route'), findsOneWidget);
  });

  testWidgets('keeps the hub useful when no business route is registered', (
    tester,
  ) async {
    final routes = MobileRouteRegistry.empty();
    await tester.pumpWidget(_companyApp(routes));

    expect(find.text('Your company'), findsOneWidget);
    expect(find.text('Settings & appearance'), findsOneWidget);
    expect(find.text('RUN THE COMPANY'), findsNothing);
    expect(find.text('GROW THE BUSINESS'), findsNothing);

    await tester.tap(find.text('Settings & appearance'));
    await tester.pumpAndSettle();
    expect(find.text('Settings route'), findsOneWidget);
  });

  testWidgets('keeps business money and AI credits on separate routes', (
    tester,
  ) async {
    final routes = MobileRouteRegistry.empty()
        .register(
          MobileBusinessRoutes.money,
          (_, _) => const Text('Business money route'),
        )
        .register(
          MobileRoutes.creditsBalance,
          (_, _) => const Text('Credits balance route'),
        );
    await tester.pumpWidget(_companyApp(routes));

    expect(find.text('Money'), findsOneWidget);
    expect(find.text('AI spend & credits'), findsOneWidget);

    await tester.tap(find.text('Money'));
    await tester.pumpAndSettle();
    expect(find.text('Business money route'), findsOneWidget);
    Navigator.of(tester.element(find.text('Business money route'))).pop();
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('AI spend & credits'));
    await tester.tap(find.text('AI spend & credits'));
    await tester.pumpAndSettle();
    expect(find.text('Credits balance route'), findsOneWidget);
  });

  testWidgets('opens the existing quick actions from the hub header', (
    tester,
  ) async {
    var opened = false;
    await tester.pumpWidget(
      _companyApp(
        MobileRouteRegistry.empty(),
        onOpenQuickActions: () => opened = true,
      ),
    );

    expect(find.bySemanticsLabel('Quick actions'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Quick actions'));
    expect(opened, isTrue);
  });
}

void _ignoreQuickActions() {}
