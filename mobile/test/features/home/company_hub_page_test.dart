import 'package:buzz/features/home/company_hub_page.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
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
          MobileBusinessRoutes.discovery,
          (_, _) => const Text('Discovery route'),
        );

    await tester.pumpWidget(_companyApp(routes));

    expect(find.text('Your company'), findsOneWidget);
    expect(find.text('Lerato Social'), findsOneWidget);
    expect(find.text('LM'), findsOneWidget);
    expect(find.text('RUN THE COMPANY'), findsOneWidget);
    expect(find.text('Team'), findsOneWidget);
    expect(find.text('People & agents'), findsOneWidget);
    expect(find.text('GROW THE BUSINESS'), findsOneWidget);
    expect(find.text('Discovery'), findsOneWidget);
    expect(find.text('Goals'), findsNothing);
    expect(find.text('Work'), findsNothing);
    expect(find.text('Workflows'), findsNothing);
    expect(find.text('Social'), findsNothing);
    expect(find.text('Website'), findsNothing);
    expect(find.text('Money'), findsNothing);

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
    expect(find.text('Appearance & preferences'), findsOneWidget);
    expect(find.text('RUN THE COMPANY'), findsNothing);
    expect(find.text('GROW THE BUSINESS'), findsNothing);

    await tester.tap(find.text('Appearance & preferences'));
    await tester.pumpAndSettle();
    expect(find.text('Settings route'), findsOneWidget);
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
