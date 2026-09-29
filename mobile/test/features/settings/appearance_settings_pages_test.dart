import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_provider.dart';
import 'package:buzz/features/settings/appearance_settings_pages.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('appearance exposes the frozen controls and theme catalog', (
    tester,
  ) async {
    await _pumpPage(tester, child: const AppearanceSettingsPage());

    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Mode'), findsOneWidget);
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Theme'), findsOneWidget);
    expect(find.text('Colony'), findsOneWidget);
    expect(find.text('Density'), findsOneWidget);
    expect(find.text('Comfortable'), findsOneWidget);
    expect(find.text('Text size'), findsOneWidget);
    expect(find.text('Default'), findsOneWidget);
    expect(find.text('Ready for review'), findsNothing);

    await tester.scrollUntilVisible(
      find.text('Browse named themes'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text('${themeCatalog.length} themes · Preview before applying'),
      findsOneWidget,
    );
    await tester.tap(find.text('Browse named themes'));
    await tester.pumpAndSettle();
    _expectThemeCatalog();
  });

  testWidgets('applied theme keeps its frozen preview and actions', (
    tester,
  ) async {
    await _pumpPage(tester, child: const ThemeAppliedPage(themeName: 'Colony'));

    expect(find.text('Launch notes'), findsOneWidget);
    expect(find.text('A real workspace update.'), findsOneWidget);
    expect(find.text('Maya Ndlovu'), findsNothing);
    expect(find.text('Colony'), findsOneWidget);
    expect(find.text('Browse themes'), findsOneWidget);
    expect(
      find.ancestor(of: find.text('Done'), matching: find.byType(SafeArea)),
      findsOneWidget,
    );
    await tester.tap(find.text('Browse themes'));
    await tester.pumpAndSettle();

    _expectThemeCatalog();
  });
}

void _expectThemeCatalog() {
  expect(find.text('Find your atmosphere.'), findsOneWidget);
  expect(
    find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.hintText == 'Search ${themeCatalog.length} themes',
    ),
    findsOneWidget,
  );
  expect(find.text('All'), findsOneWidget);
  expect(find.text('Light'), findsOneWidget);
  expect(find.text('Dark'), findsOneWidget);
}

Future<void> _pumpPage(WidgetTester tester, {required Widget child}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final registry = MobileRouteRegistry.empty().register(
    MobileRoutes.settingsThemes,
    (context, _) => const ThemeCatalogPage(),
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        communityThemeProvider.overrideWith(_TestCommunityThemeNotifier.new),
        profileProvider.overrideWith(_TestProfileNotifier.new),
        userStatusProvider.overrideWith(_TestUserStatusNotifier.new),
        channelsProvider.overrideWith(_TestChannelsNotifier.new),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: MobileRouteScope(registry: registry, child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _TestCommunityThemeNotifier extends CommunityThemeNotifier {
  @override
  CommunityThemePreference build() => defaultCommunityTheme;
}

class _TestProfileNotifier extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async =>
      const UserProfile(pubkey: 'test-profile', displayName: 'Test Member');
}

class _TestUserStatusNotifier extends UserStatusNotifier {
  @override
  Future<UserStatus?> build() async => null;
}

class _TestChannelsNotifier extends ChannelsNotifier {
  @override
  Future<List<Channel>> build() async => [
    Channel(
      id: 'test-channel',
      name: 'Launch notes',
      channelType: 'stream',
      visibility: 'open',
      description: '',
      createdBy: 'a' * 64,
      createdAt: DateTime.utc(2026, 9, 29),
      memberCount: 1,
      lastMessageContent: 'A real workspace update.',
      lastMessagePubkey: 'a' * 64,
      lastMessageCreatedAt: 1790700000,
    ),
  ];
}
