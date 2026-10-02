import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_provider.dart';
import 'package:buzz/features/settings/appearance_settings_pages.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/community/community_provider.dart';
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

  testWidgets('selected theme keeps its frozen preview and actions', (
    tester,
  ) async {
    await _pumpPage(tester, child: const ThemeAppliedPage(themeName: 'Colony'));

    expect(find.text('APPLIED'), findsOneWidget);
    expect(
      find.text('Preview uses sample content, never private messages.'),
      findsOneWidget,
    );
    expect(find.text('Theme selected'), findsOneWidget);
    expect(find.text('Sample message'), findsOneWidget);
    expect(find.text('A real workspace update.'), findsNothing);
    expect(find.text('Launch notes'), findsNothing);
    await tester.scrollUntilVisible(
      find.text('Preview an empty channel'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Preview an empty channel'));
    await tester.pumpAndSettle();

    expect(find.text('A little space to begin.'), findsOneWidget);
    expect(find.text('Sample message'), findsNothing);
    expect(find.text('Preview with a message'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Back to themes'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Use Colony'), findsOneWidget);
    await tester.tap(find.text('Back to themes'));
    await tester.pumpAndSettle();

    _expectThemeCatalog();
  });

  testWidgets('theme preview starts empty and only shows generic sample copy', (
    tester,
  ) async {
    await _pumpPage(tester, child: const ThemePreviewPage(themeName: 'Colony'));

    expect(find.text('A little space to begin.'), findsOneWidget);
    expect(
      find.text('Your first conversation will appear here.'),
      findsOneWidget,
    );
    expect(find.text('Launch notes'), findsNothing);
    expect(find.text('A real workspace update.'), findsNothing);
    expect(
      find.text('Preview uses sample content, never private messages.'),
      findsOneWidget,
    );

    await tester.scrollUntilVisible(
      find.text('Preview with a message'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.text('Preview with a message'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Preview with a message'));
    await tester.pumpAndSettle();

    expect(find.text('Sample message'), findsOneWidget);
    expect(find.text('Illustrative content'), findsOneWidget);
    expect(find.text('A real workspace update.'), findsNothing);
    expect(find.text('Maya Ndlovu'), findsNothing);
  });
}

void _expectThemeCatalog() {
  expect(find.text('Named themes'), findsOneWidget);
  expect(find.text('Find your atmosphere.'), findsOneWidget);
  expect(
    find.text('Preview with sample content before applying.'),
    findsOneWidget,
  );
  expect(find.text('Search'), findsNothing);
  expect(find.text('Colony'), findsOneWidget);
  expect(find.text('Colony Dark'), findsOneWidget);
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
        activeCommunityProvider.overrideWith((_) async => null),
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
