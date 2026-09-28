import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/features/profile/profile_status_emoji_page.dart';
import 'package:buzz/features/profile/profile_status_page.dart';
import 'package:buzz/features/profile/profile_status_saved_page.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_provider.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
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
  testWidgets(
    'saves the selected status through the real status provider seam',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final statusNotifier = _RecordingStatusNotifier(
        const UserStatus(
          text: 'In a meeting',
          emoji: '📅',
          updatedAt: 1,
          expiresAt: 4_000_000_000,
        ),
      );
      await tester.pumpWidget(
        _testApp(
          statusNotifier: statusNotifier,
          prefs: prefs,
          community: Community.create(
            name: 'Lerato Social',
            relayUrl: 'wss://relay.example',
          ),
          child: const ProfileStatusPage(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('What’s your status?'), findsOneWidget);
      expect(find.text('Visible to people in Lerato Social.'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('In a meeting'), findsWidgets);

      await tester.tap(find.text('Commuting').last);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Commuting',
      );
      await tester.tap(find.text('Save status'));
      await tester.pumpAndSettle();

      expect(statusNotifier.savedText, 'Commuting');
      expect(statusNotifier.savedEmoji, '🚌');
      expect(statusNotifier.savedExpiresAt, isNotNull);
      expect(find.byType(ProfileStatusSavedPage), findsOneWidget);
      expect(find.text('🚌'), findsWidgets);
      expect(find.text('Commuting'), findsWidgets);
    },
  );

  testWidgets('returns the selected status emoji to the editor', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final statusNotifier = _RecordingStatusNotifier(null);
    await tester.pumpWidget(
      _testApp(
        statusNotifier: statusNotifier,
        prefs: prefs,
        community: null,
        child: const ProfileStatusPage(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsLabel('Choose status emoji'));
    await tester.pumpAndSettle();
    expect(find.byType(ProfileStatusEmojiPage), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Sunflower'));
    await tester.pumpAndSettle();

    expect(find.byType(ProfileStatusPage), findsOneWidget);
    expect(find.text('🌻'), findsOneWidget);
  });
}

Widget _testApp({
  required UserStatusNotifier statusNotifier,
  required SharedPreferences prefs,
  required Community? community,
  required Widget child,
}) {
  final registry = MobileRouteRegistry.empty()
      .register(
        MobileRoutes.profileStatusEmoji,
        (context, selectedEmoji) =>
            ProfileStatusEmojiPage(selectedEmoji: selectedEmoji),
      )
      .register(
        MobileRoutes.profileStatusSaved,
        (context, _) => const ProfileStatusSavedPage(),
      );
  return ProviderScope(
    overrides: [
      userStatusProvider.overrideWith(() => statusNotifier),
      profileProvider.overrideWith(_EmptyProfileNotifier.new),
      activeCommunityProvider.overrideWith((_) async => community),
      savedPrefsProvider.overrideWithValue(prefs),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      home: MobileRouteScope(registry: registry, child: child),
    ),
  );
}

class _RecordingStatusNotifier extends UserStatusNotifier {
  _RecordingStatusNotifier(this.initialStatus);

  final UserStatus? initialStatus;
  String? savedText;
  String? savedEmoji;
  DateTime? savedExpiresAt;

  @override
  Future<UserStatus?> build() async => initialStatus;

  @override
  Future<void> setStatus(
    String text,
    String emoji, {
    DateTime? expiresAt,
  }) async {
    savedText = text;
    savedEmoji = emoji;
    savedExpiresAt = expiresAt;
    state = AsyncValue.data(
      text.isEmpty && emoji.isEmpty
          ? null
          : UserStatus(
              text: text,
              emoji: emoji,
              updatedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
              expiresAt: expiresAt == null
                  ? null
                  : expiresAt.millisecondsSinceEpoch ~/ 1000,
            ),
    );
  }

  @override
  Future<void> clearStatus() async {
    savedText = '';
    savedEmoji = '';
    state = const AsyncValue.data(null);
  }
}

class _EmptyProfileNotifier extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async => null;
}
