import 'dart:convert';

import 'package:buzz/features/settings/appearance_display_preference.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('persists the complete local display preference snapshot', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(container.dispose);

    const preference = AppearanceDisplayPreference(
      density: AppearanceDensity.compact,
      textSize: AppearanceTextSize.larger,
      reduceMotion: true,
      largerTapTargets: false,
    );
    await container
        .read(appearanceDisplayPreferenceProvider.notifier)
        .setPreference(preference);

    expect(container.read(appearanceDisplayPreferenceProvider), preference);
    expect(
      jsonDecode(prefs.getString('buzz-appearance-display.v1')!),
      preference.toJson(),
    );

    final restored = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(restored.dispose);
    expect(restored.read(appearanceDisplayPreferenceProvider), preference);
  });
}
