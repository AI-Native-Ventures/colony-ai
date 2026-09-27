import 'package:buzz/features/settings/appearance_settings_pages.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('appearance links to the searchable named theme catalog', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final themeNotifier = _TestCommunityThemeNotifier();
    final registry = MobileRouteRegistry.empty().register(
      MobileRoutes.settingsThemes,
      (context, _) => const ThemeCatalogPage(),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          savedPrefsProvider.overrideWithValue(prefs),
          communityThemeProvider.overrideWith(() => themeNotifier),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: MobileRouteScope(
            registry: registry,
            child: const AppearanceSettingsPage(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Colony'), findsOneWidget);
    expect(find.text('Comfortable'), findsOneWidget);
    expect(find.text('Default'), findsOneWidget);
    await tester.drag(find.byType(ListView).first, const Offset(0, -360));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Browse named themes'));
    await tester.pumpAndSettle();

    expect(find.text('Find your atmosphere.'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.hintText == 'Search 62 themes',
      ),
      findsOneWidget,
    );
    expect(find.text('All'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
  });
}

class _TestCommunityThemeNotifier extends CommunityThemeNotifier {
  @override
  CommunityThemePreference build() => defaultCommunityTheme;
}
