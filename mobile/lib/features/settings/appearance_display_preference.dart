import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme_provider.dart';

enum AppearanceDensity {
  compact('Compact'),
  comfortable('Comfortable'),
  spacious('Spacious');

  const AppearanceDensity(this.label);

  final String label;

  VisualDensity get visualDensity => switch (this) {
    AppearanceDensity.compact => const VisualDensity(vertical: -1),
    AppearanceDensity.comfortable => VisualDensity.standard,
    AppearanceDensity.spacious => const VisualDensity(vertical: 1),
  };
}

enum AppearanceTextSize {
  standard('Default', 1),
  larger('Larger', 1.1);

  const AppearanceTextSize(this.label, this.scale);

  final String label;
  final double scale;
}

/// Applies the app text-size choice on top of the platform's nonlinear scaler.
TextScaler applyAppearanceTextSize(
  TextScaler system,
  AppearanceTextSize size,
) => _AppearanceTextScaler(base: system, multiplier: size.scale);

class _AppearanceTextScaler extends TextScaler {
  const _AppearanceTextScaler({
    required this.base,
    required this.multiplier,
    this.minScaleFactor = 0.0,
    this.maxScaleFactor = double.infinity,
  });

  final TextScaler base;
  final double multiplier;
  final double minScaleFactor;
  final double maxScaleFactor;

  @override
  double get textScaleFactor => scale(14) / 14;

  @override
  double scale(double fontSize) {
    final platformSize = base.scale(fontSize);
    final platformFactor = platformSize / fontSize;
    return fontSize *
        (platformFactor * multiplier).clamp(minScaleFactor, maxScaleFactor);
  }

  @override
  TextScaler clamp({
    double minScaleFactor = 0.8,
    double maxScaleFactor = 1.2,
  }) => _AppearanceTextScaler(
    base: this,
    multiplier: 1,
    minScaleFactor: minScaleFactor,
    maxScaleFactor: maxScaleFactor,
  );
}

@immutable
class AppearanceDisplayPreference {
  const AppearanceDisplayPreference({
    this.density = AppearanceDensity.comfortable,
    this.textSize = AppearanceTextSize.standard,
    this.reduceMotion = false,
    this.largerTapTargets = false,
  });

  final AppearanceDensity density;
  final AppearanceTextSize textSize;
  final bool reduceMotion;
  final bool largerTapTargets;

  Map<String, Object> toJson() => {
    'version': 1,
    'density': density.name,
    'textSize': textSize.name,
    'reduceMotion': reduceMotion,
    'largerTapTargets': largerTapTargets,
  };

  @override
  bool operator ==(Object other) =>
      other is AppearanceDisplayPreference &&
      density == other.density &&
      textSize == other.textSize &&
      reduceMotion == other.reduceMotion &&
      largerTapTargets == other.largerTapTargets;

  @override
  int get hashCode =>
      Object.hash(density, textSize, reduceMotion, largerTapTargets);

  factory AppearanceDisplayPreference.fromJson(Map<String, dynamic> json) {
    if (json['version'] != 1 ||
        json['density'] is! String ||
        json['textSize'] is! String ||
        json['reduceMotion'] is! bool ||
        json['largerTapTargets'] is! bool) {
      throw const FormatException('Invalid appearance display preference');
    }
    return AppearanceDisplayPreference(
      density: AppearanceDensity.values.firstWhere(
        (value) => value.name == json['density'],
      ),
      textSize: AppearanceTextSize.values.firstWhere(
        (value) => value.name == json['textSize'],
      ),
      reduceMotion: json['reduceMotion'] as bool,
      largerTapTargets: json['largerTapTargets'] as bool,
    );
  }
}

class AppearanceDisplayPreferenceNotifier
    extends Notifier<AppearanceDisplayPreference> {
  @override
  AppearanceDisplayPreference build() {
    final encoded = ref.watch(savedPrefsProvider).getString(_storageKey);
    if (encoded == null) return const AppearanceDisplayPreference();
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is Map<String, dynamic>) {
        return AppearanceDisplayPreference.fromJson(decoded);
      }
    } on FormatException {
      return const AppearanceDisplayPreference();
    } on StateError {
      return const AppearanceDisplayPreference();
    }
    return const AppearanceDisplayPreference();
  }

  /// Persists density and text size together as one preference snapshot.
  Future<void> setPreference(AppearanceDisplayPreference preference) async {
    final saved = await ref
        .read(savedPrefsProvider)
        .setString(_storageKey, jsonEncode(preference.toJson()));
    if (!saved) throw StateError('Appearance preferences could not be saved.');
    state = preference;
  }
}

const _storageKey = 'buzz-appearance-display.v1';

final appearanceDisplayPreferenceProvider =
    NotifierProvider<
      AppearanceDisplayPreferenceNotifier,
      AppearanceDisplayPreference
    >(AppearanceDisplayPreferenceNotifier.new);
