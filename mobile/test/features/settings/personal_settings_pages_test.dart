import 'package:buzz/features/settings/personal_settings_home_page.dart';
import 'package:buzz/features/settings/appearance_settings_pages.dart'
    show PersonalPreferencesPage;
import 'package:buzz/features/settings/profile_settings_page.dart';
import 'package:buzz/features/settings/settings_devices_page.dart';
import 'package:buzz/features/settings/settings_clear_cache_page.dart';
import 'package:buzz/features/settings/settings_export_failed_page.dart';
import 'package:buzz/features/settings/settings_export_page.dart';
import 'package:buzz/features/settings/settings_feedback_page.dart';
import 'package:buzz/features/settings/settings_feedback_sent_page.dart';
import 'package:buzz/features/settings/settings_privacy_page.dart';
import 'package:buzz/features/settings/settings_save_failed_page.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('opens the designed account route from personal settings', (
    tester,
  ) async {
    final prefs = await _prefs();
    await tester.pumpWidget(
      _testApp(
        prefs: prefs,
        registry: MobileRouteRegistry.empty().register(
          MobileRoutes.settingsProfile,
          (context, _) => const Scaffold(body: Text('Profile route opened')),
        ),
        child: const PersonalSettingsHomePage(
          displayName: 'Lerato Molefe',
          email: 'lerato@example.com',
          avatarUrl: null,
        ),
      ),
    );

    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Preferences'), findsOneWidget);
    await tester.tap(find.text('Account').first);
    await tester.pumpAndSettle();
    expect(find.text('Profile route opened'), findsOneWidget);
  });

  testWidgets('keeps the profile edit when the live update fails', (
    tester,
  ) async {
    final prefs = await _prefs();
    await tester.pumpWidget(
      _testApp(
        prefs: prefs,
        registry: MobileRouteRegistry.empty().register(
          MobileRoutes.settingsSaveFailed,
          (context, _) => const SettingsSaveFailedPage(),
        ),
        child: ProfileSettingsPage(
          displayName: 'Lerato Molefe',
          avatarUrl: null,
          email: 'lerato@example.com',
          statusLabel: 'Set a status',
          onSaveDisplayName: (_) async => throw StateError('relay unavailable'),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), 'Lerato M.');
    await tester.tap(find.text('Save profile'));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsSaveFailedPage), findsOneWidget);
    expect(find.text('Your edits are kept'), findsOneWidget);
    expect(prefs.getString('buzz-profile-settings-name-draft.v1'), 'Lerato M.');
    await tester.tap(find.text('Return to my edits'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Lerato M.',
    );
  });

  testWidgets('shows the current device and retains the pairing entry', (
    tester,
  ) async {
    var linkedAnotherDevice = false;
    var openedDeviceDetails = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: SettingsDevicesPage(
          currentDeviceName: 'This iPhone',
          onOpenCurrentDevice: () => openedDeviceDetails = true,
          onLinkAnotherDevice: () => linkedAnotherDevice = true,
        ),
      ),
    );
    expect(find.text('Devices'), findsOneWidget);
    expect(find.text('This iPhone'), findsOneWidget);
    expect(find.text('Active now'), findsOneWidget);
    expect(find.text('Lerato’s Mac'), findsNothing);
    await tester.tap(find.text('This iPhone'));
    expect(openedDeviceDetails, isTrue);
    await tester.tap(find.text('Link another device'));
    expect(linkedAnotherDevice, isTrue);
  });

  testWidgets('does not offer to clear an untracked downloaded-file cache', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: const SettingsClearCachePage(),
      ),
    );

    expect(find.text('Clear downloads'), findsOneWidget);
    expect(find.textContaining('128 MB'), findsNothing);
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Clear downloads'),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('keeps feedback on device and labels the result as a preview', (
    tester,
  ) async {
    final prefs = await _prefs();
    await tester.pumpWidget(
      _testApp(
        prefs: prefs,
        registry: MobileRouteRegistry.empty().register(
          MobileRoutes.settingsFeedbackSent,
          (context, _) => const SettingsFeedbackSentPage(),
        ),
        child: const SettingsFeedbackPage(),
      ),
    );

    expect(find.text('Help us make it better.'), findsNothing);
    expect(find.text('Topic'), findsOneWidget);
    expect(find.text('Feedback'), findsOneWidget);
    expect(find.text('Design feedback'), findsOneWidget);
    final feedbackButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Send feedback preview'),
    );
    expect(feedbackButton.onPressed, isNotNull);
    await tester.enterText(find.byType(TextField), 'A calmer theme catalog.');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send feedback preview'));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsFeedbackSentPage), findsOneWidget);
    expect(
      find.text(
        'Your feedback submission is shown here as a preview. No report was sent.',
      ),
      findsOneWidget,
    );
    expect(prefs.getString('buzz-settings-feedback-preview.v1'), isNotNull);
  });

  testWidgets('uses checkboxes for phone accessibility preferences', (
    tester,
  ) async {
    final prefs = await _prefs();
    await tester.pumpWidget(
      _testApp(
        prefs: prefs,
        registry: MobileRouteRegistry.empty(),
        child: const PersonalPreferencesPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Push notifications for this community'), findsOneWidget);
    expect(find.byType(Checkbox), findsNWidgets(2));
    await tester.tap(find.byType(Checkbox).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply preferences'));
    await tester.pumpAndSettle();

    expect(
      prefs.getString('buzz-appearance-display.v1'),
      contains('"reduceMotion":true'),
    );
  });

  testWidgets('saves notification privacy as an on-device preview', (
    tester,
  ) async {
    final prefs = await _prefs();
    await tester.pumpWidget(
      _testApp(
        prefs: prefs,
        registry: MobileRouteRegistry.empty().register(
          MobileRoutes.settingsPrivacy,
          (context, _) => const SettingsPrivacyPage(),
        ),
        child: const PersonalPreferencesPage(),
      ),
    );

    await tester.tap(find.text('Preview privacy'));
    await tester.pumpAndSettle();
    expect(find.text('Lock-screen preview'), findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Show message previews').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save preview privacy'));
    await tester.pumpAndSettle();

    expect(
      prefs.getString('buzz-notification-privacy-preview.v1'),
      'Show message previews',
    );
    expect(find.text('Preferences'), findsOneWidget);
  });

  testWidgets(
    'labels export actions as previews and exposes the designed retry',
    (tester) async {
      final prefs = await _prefs();
      await tester.pumpWidget(
        _testApp(
          prefs: prefs,
          registry: MobileRouteRegistry.empty().register(
            MobileRoutes.settingsExportFailed,
            (context, _) => const SettingsExportFailedPage(),
          ),
          child: const SettingsExportPage(),
        ),
      );

      await tester.tap(find.text('Prepare export preview'));
      await tester.pumpAndSettle();
      expect(
        find.text('Export prepared in this preview. No file downloaded.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Preview export failure'));
      await tester.pumpAndSettle();
      expect(find.byType(SettingsExportFailedPage), findsOneWidget);
      expect(find.text('Your export could not be prepared'), findsOneWidget);
    },
  );
}

Future<SharedPreferences> _prefs() async {
  SharedPreferences.setMockInitialValues({});
  return SharedPreferences.getInstance();
}

Widget _testApp({
  required SharedPreferences prefs,
  required MobileRouteRegistry registry,
  required Widget child,
}) => ProviderScope(
  overrides: [savedPrefsProvider.overrideWithValue(prefs)],
  child: MaterialApp(
    theme: AppTheme.light(),
    home: MobileRouteScope(registry: registry, child: child),
  ),
);
