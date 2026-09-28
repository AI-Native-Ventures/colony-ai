import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:buzz/features/channels/channel.dart';
import 'package:buzz/features/channels/channels_provider.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/features/profile/profile_avatar_page.dart';
import 'package:buzz/features/profile/profile_avatar_capture_page.dart';
import 'package:buzz/features/profile/profile_avatar_crop_route_page.dart';
import 'package:buzz/features/profile/profile_avatar_emoji_page.dart';
import 'package:buzz/features/profile/profile_avatar_review_page.dart';
import 'package:buzz/features/profile/profile_avatar_state_page.dart';
import 'package:buzz/features/profile/profile_image_page.dart';
import 'package:buzz/features/profile/profile_status_emoji_page.dart';
import 'package:buzz/features/profile/profile_status_page.dart';
import 'package:buzz/features/profile/profile_status_saved_page.dart';
import 'package:buzz/features/profile/user_status.dart';
import 'package:buzz/features/profile/user_status_provider.dart';
import 'package:buzz/features/settings/appearance_display_preference.dart';
import 'package:buzz/features/settings/appearance_settings_pages.dart';
import 'package:buzz/features/settings/personal_settings_home_page.dart';
import 'package:buzz/features/settings/profile_settings_page.dart';
import 'package:buzz/features/settings/settings_devices_page.dart';
import 'package:buzz/features/settings/settings_device_page.dart';
import 'package:buzz/features/settings/settings_clear_cache_page.dart';
import 'package:buzz/features/settings/settings_feedback_page.dart';
import 'package:buzz/features/settings/settings_feedback_failed_page.dart';
import 'package:buzz/features/settings/settings_feedback_sent_page.dart';
import 'package:buzz/features/settings/settings_export_page.dart';
import 'package:buzz/features/settings/settings_export_failed_page.dart';
import 'package:buzz/features/settings/settings_notifications_page.dart';
import 'package:buzz/features/settings/settings_privacy_page.dart';
import 'package:buzz/features/settings/settings_save_failed_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';

ui.Image? _avatarCameraPreviewImage;
ui.Image? _savedProfileAvatarImage;
final _profileEmojiImages = <String, ui.Image>{};

const _profileEmojiFixtureNames = <String, String>{
  '🌿': 'herb',
  '🌻': 'sunflower',
  '✨': 'sparkles',
  '📅': 'calendar',
  '🚌': 'bus',
  '🍵': 'tea',
  '🏖️': 'beach',
  '🏠': 'house',
  '💻': 'laptop',
  '🎨': 'palette',
  '🚀': 'rocket',
  '📚': 'books',
};

void main() {
  const captureScreenshots = bool.fromEnvironment(
    'CAPTURE_W23_PROFILE_SETTINGS_SHOTS',
  );
  final output = Directory('/tmp/w23-mobile-profile-settings-proof')
    ..createSync(recursive: true);

  setUpAll(() async {
    final savedAvatarBytes = File(
      'test/fixtures/profile_saved_avatar.png',
    ).readAsBytesSync();
    final savedAvatarCodec = await ui.instantiateImageCodec(savedAvatarBytes);
    _savedProfileAvatarImage = (await savedAvatarCodec.getNextFrame()).image;
    final bytes = File(
      'test/fixtures/profile_avatar_camera_preview.png',
    ).readAsBytesSync();
    final codec = await ui.instantiateImageCodec(bytes);
    _avatarCameraPreviewImage = (await codec.getNextFrame()).image;
    for (final entry in _profileEmojiFixtureNames.entries) {
      final emojiBytes = File(
        'test/fixtures/profile_emojis/${entry.value}.png',
      ).readAsBytesSync();
      final emojiCodec = await ui.instantiateImageCodec(emojiBytes);
      _profileEmojiImages[entry.key] = (await emojiCodec.getNextFrame()).image;
    }
  });

  tearDownAll(() {
    _avatarCameraPreviewImage?.dispose();
    _savedProfileAvatarImage?.dispose();
    for (final image in _profileEmojiImages.values) {
      image.dispose();
    }
  });

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _screenCases) {
        testWidgets('captures ${screen.name} ${brightness.name} '
            '${size.width.toInt()}x${size.height.toInt()}', (tester) async {
          debugDefaultTargetPlatformOverride = TargetPlatform.android;
          final previousComparator = goldenFileComparator;
          if (captureScreenshots) {
            goldenFileComparator = LocalFileComparator(
              Uri.file('${output.path}/proof_test.dart'),
            );
            tester.view.viewPadding = const FakeViewPadding(
              top: 72,
              bottom: 20,
            );
            tester.view.padding = const FakeViewPadding(top: 72, bottom: 20);
          }
          addTearDown(() {
            debugDefaultTargetPlatformOverride = null;
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.view.viewPadding = FakeViewPadding.zero;
            tester.view.padding = FakeViewPadding.zero;
            goldenFileComparator = previousComparator;
          });
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          if (captureScreenshots) await _loadProofFonts();

          final prefs = await _proofPreferences(
            showMessagePreview: screen.name == 'settings-privacy-message',
          );
          final rootKey = GlobalKey();
          final app = MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            home: screen.name == 'settings-home'
                ? MobileShell(
                    destination: MobileShellDestination.company,
                    onDestinationSelected: (_) {},
                    showBrandBar: false,
                    child: screen.build(),
                  )
                : screen.build(),
          );
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                savedPrefsProvider.overrideWithValue(prefs),
                communityThemeProvider.overrideWith(
                  _ProofCommunityThemeNotifier.new,
                ),
                channelsProvider.overrideWith(_ProofChannelsNotifier.new),
                userStatusProvider.overrideWith(
                  screen.name == 'profile-status-saved'
                      ? _ProofEmptyUserStatusNotifier.new
                      : _ProofUserStatusNotifier.new,
                ),
                profileProvider.overrideWith(
                  screen.name == 'profile-status-saved'
                      ? _ProofSavedProfileNotifier.new
                      : _ProofProfileNotifier.new,
                ),
                activeCommunityProvider.overrideWith(
                  (_) async => Community.create(
                    name: 'Lerato Social',
                    relayUrl: 'wss://relay.example',
                  ),
                ),
                mediaUploadServiceProvider.overrideWithValue(
                  _proofMediaUploadService,
                ),
              ],
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
                              app,
                              _ProofStatusBar(brightness: brightness),
                              _ProofHomeIndicator(brightness: brightness),
                            ],
                          ),
                        ),
                      )
                    : app,
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.pump(const Duration(milliseconds: 450));

          if (captureScreenshots) {
            if (screen.name == 'settings-appearance') {
              expect(find.text('System'), findsOneWidget);
              expect(find.text('Colony'), findsOneWidget);
              expect(find.text('Comfortable'), findsOneWidget);
              expect(find.text('Default'), findsOneWidget);
              expect(find.text('📅 In a meeting'), findsOneWidget);
              expect(find.text('Ready for review'), findsNothing);
            }
            final filename =
                '${screen.name}-${brightness.name}-'
                '${size.width.toInt()}x${size.height.toInt()}.png';
            await expectLater(find.byKey(rootKey), matchesGoldenFile(filename));
            debugPrint('VISUAL_PROOF ${output.path}/$filename');
          } else {
            expect(find.byKey(rootKey), findsOneWidget);
          }
          debugDefaultTargetPlatformOverride = null;
        });
      }
    }
  }
}

final _screenCases = <_ScreenCase>[
  _ScreenCase(
    'settings-home',
    () => const PersonalSettingsHomePage(
      displayName: 'Lerato Molefe',
      email: 'lerato@example.com',
      avatarUrl: null,
      communityName: 'Lerato Social',
      onOpenBusiness: _noop,
      onOpenAgents: _noop,
    ),
  ),
  _ScreenCase(
    'settings-profile',
    () => ProfileSettingsPage(
      displayName: 'Lerato Molefe',
      avatarUrl: null,
      email: 'lerato@example.com',
      statusLabel: 'Set a status',
      onSaveDisplayName: (_) async {},
    ),
  ),
  _ScreenCase('settings-appearance', () => const AppearanceSettingsPage()),
  _ScreenCase(
    'settings-theme-preview',
    () => const ThemePreviewPage(themeName: 'Colony'),
  ),
  _ScreenCase(
    'settings-theme-applied',
    () => const ThemeAppliedPage(themeName: 'Colony'),
  ),
  _ScreenCase('settings-preferences', () => const PersonalPreferencesPage()),
  _ScreenCase(
    'settings-devices',
    () => SettingsDevicesPage(
      currentDeviceName: 'This iPhone',
      onOpenCurrentDevice: _noop,
      onLinkAnotherDevice: _noop,
    ),
  ),
  _ScreenCase('settings-clear-cache', () => const SettingsClearCachePage()),
  _ScreenCase(
    'settings-device',
    () => const SettingsDevicePage(
      deviceName: 'This iPhone',
      communityName: 'Lerato Social',
    ),
  ),
  _ScreenCase(
    'settings-notifications',
    () => const SettingsNotificationsPage(),
  ),
  _ScreenCase('settings-feedback', () => const SettingsFeedbackPage()),
  _ScreenCase('settings-feedback-sent', () => const SettingsFeedbackSentPage()),
  _ScreenCase(
    'settings-feedback-failed',
    () => const SettingsFeedbackFailedPage(),
  ),
  _ScreenCase('settings-privacy', () => const SettingsPrivacyPage()),
  _ScreenCase('settings-privacy-message', () => const SettingsPrivacyPage()),
  _ScreenCase('settings-export', () => const SettingsExportPage()),
  _ScreenCase('settings-export-failed', () => const SettingsExportFailedPage()),
  _ScreenCase(
    'profile-status',
    () => ProfileStatusPage(emojiBuilder: _proofEmoji),
  ),
  _ScreenCase(
    'profile-status-emoji',
    () =>
        ProfileStatusEmojiPage(selectedEmoji: '📅', emojiBuilder: _proofEmoji),
  ),
  _ScreenCase(
    'profile-status-saved',
    () => ProfileStatusSavedPage(
      emojiBuilder: _proofEmoji,
      avatarBuilder: _proofSavedAvatar,
    ),
  ),
  _ScreenCase('settings-save-failed', () => const SettingsSaveFailedPage()),
  _ScreenCase('settings-themes', () => const ThemeCatalogPage()),
  _ScreenCase('profile-avatar', () => const ProfileAvatarPage()),
  _ScreenCase('profile-image', () => const ProfileImagePage()),
  _ScreenCase(
    'profile-crop',
    () => ProfileAvatarCropRoutePage(imageBytes: Uint8List(0)),
  ),
  _ScreenCase(
    'profile-invalid',
    () => const ProfileAvatarStatePage(state: ProfileAvatarState.invalid),
  ),
  _ScreenCase(
    'profile-saving',
    () => const ProfileAvatarStatePage(state: ProfileAvatarState.saving),
  ),
  _ScreenCase(
    'profile-saved',
    () => const ProfileAvatarStatePage(state: ProfileAvatarState.saved),
  ),
  _ScreenCase(
    'profile-failed',
    () => const ProfileAvatarStatePage(state: ProfileAvatarState.failed),
  ),
  _ScreenCase(
    'profile-avatar-camera-denied',
    () => const ProfileAvatarStatePage(state: ProfileAvatarState.cameraDenied),
  ),
  _ScreenCase(
    'profile-avatar-emoji',
    () => ProfileAvatarEmojiPage(emojiBuilder: _proofEmoji),
  ),
  _ScreenCase('profile-avatar-review', () => const ProfileAvatarReviewPage()),
  _ScreenCase(
    'profile-avatar-saved',
    () => ProfileAvatarStatePage(
      state: ProfileAvatarState.avatarSaved,
      savedAvatarBuilder: _proofSavedAvatar,
    ),
  ),
  _ScreenCase(
    'profile-avatar-capture',
    () => ProfileAvatarCapturePage(cameraPreviewBuilder: _avatarCameraPreview),
  ),
];

class _ScreenCase {
  const _ScreenCase(this.name, this.build);

  final String name;
  final Widget Function() build;
}

Future<SharedPreferences> _proofPreferences({
  bool showMessagePreview = false,
}) async {
  SharedPreferences.setMockInitialValues({
    'buzz-appearance-display.v1': jsonEncode(
      const AppearanceDisplayPreference(reduceMotion: true).toJson(),
    ),
    if (showMessagePreview)
      'buzz-notification-privacy-preview.v1': 'Show message previews',
  });
  return SharedPreferences.getInstance();
}

void _noop() {}

final _proofMediaUploadService = MediaUploadService(
  baseUrl: 'https://upload.example',
  nsec: null,
  pickGalleryImage: () async => null,
  pickGalleryVideo: () async => null,
);

Widget _avatarCameraPreview(BuildContext context) => SizedBox.expand(
  child: RawImage(image: _avatarCameraPreviewImage, fit: BoxFit.cover),
);

Widget _proofSavedAvatar() => SizedBox.square(
  dimension: 108,
  child: RawImage(image: _savedProfileAvatarImage),
);

Widget _proofEmoji(String emoji, double fontSize) {
  final image = _profileEmojiImages[emoji];
  if (image == null) {
    return Text(emoji, style: TextStyle(fontSize: fontSize));
  }
  return RawImage(
    image: image,
    width: fontSize,
    height: fontSize,
    fit: BoxFit.contain,
  );
}

class _ProofCommunityThemeNotifier extends CommunityThemeNotifier {
  @override
  CommunityThemePreference build() => defaultCommunityTheme;
}

class _ProofUserStatusNotifier extends UserStatusNotifier {
  @override
  Future<UserStatus?> build() async => UserStatus(
    text: 'In a meeting',
    emoji: '📅',
    updatedAt: 1,
    expiresAt:
        DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/
        1000,
  );
}

class _ProofEmptyUserStatusNotifier extends UserStatusNotifier {
  @override
  Future<UserStatus?> build() async => null;
}

class _ProofProfileNotifier extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async =>
      const UserProfile(pubkey: 'proof-profile', displayName: 'Lerato Molefe');
}

class _ProofSavedProfileNotifier extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async =>
      UserProfile(pubkey: 'proof-profile', displayName: 'Lerato Molefe');
}

class _ProofChannelsNotifier extends ChannelsNotifier {
  @override
  Future<List<Channel>> build() async => [
    Channel(
      id: 'proof-channel',
      name: 'Proof channel',
      channelType: 'stream',
      visibility: 'open',
      description: '',
      createdBy: 'a' * 64,
      createdAt: DateTime.utc(2026, 9, 29),
      memberCount: 1,
      lastMessageContent: 'A verified workspace update.',
      lastMessagePubkey: 'a' * 64,
      lastMessageCreatedAt: 1790700000,
    ),
  ];
}

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
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
  const _ProofStatusBar({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = Color(
      brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
    );
    return Positioned(
      top: 26,
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
