import 'package:flutter/material.dart';

@immutable
class AppColors extends ThemeExtension<AppColors> {
  final Color success;
  final Color warning;
  final Color accent;
  final Color huddleDrawerSurface;
  final Color huddleControlSurface;
  final Color onHuddleDrawer;

  /// Plum used by primary mobile actions.
  final Color plum;

  /// Shared lilac identity color.
  final Color lilac;

  /// Shared apricot identity color.
  final Color apricot;

  /// Text color for peach person avatars.
  final Color identityPersonForeground;

  /// Text color for sage person avatars.
  final Color identitySageForeground;

  /// Text color for agent avatars.
  final Color identityAgentForeground;

  /// Color for online identity indicators.
  final Color identityPresence;

  /// Warm gradient for the Company hub heading.
  final Gradient companyWashGradient;

  /// Gradient for peach person avatars.
  final Gradient personAvatarGradient;

  /// Gradient for sage person avatars.
  final Gradient sageAvatarGradient;

  /// Gradient for agent avatars.
  final Gradient agentAvatarGradient;

  /// Gradient for the app's top section, non-null only under the Buzz themes.
  /// Carried on the theme rather than read from a provider so any surface can
  /// opt in via `context.appColors.topSectionGradient` — see
  /// `buzzTopSectionGradient`.
  final Gradient? topSectionGradient;

  const AppColors({
    required this.success,
    required this.warning,
    required this.accent,
    required this.huddleDrawerSurface,
    required this.huddleControlSurface,
    required this.onHuddleDrawer,
    required this.plum,
    required this.lilac,
    required this.apricot,
    required this.identityPersonForeground,
    required this.identitySageForeground,
    required this.identityAgentForeground,
    required this.identityPresence,
    required this.companyWashGradient,
    required this.personAvatarGradient,
    required this.sageAvatarGradient,
    required this.agentAvatarGradient,
    this.topSectionGradient,
  });

  @override
  AppColors copyWith({
    Color? success,
    Color? warning,
    Color? accent,
    Color? huddleDrawerSurface,
    Color? huddleControlSurface,
    Color? onHuddleDrawer,
    Color? plum,
    Color? lilac,
    Color? apricot,
    Color? identityPersonForeground,
    Color? identitySageForeground,
    Color? identityAgentForeground,
    Color? identityPresence,
    Gradient? companyWashGradient,
    Gradient? personAvatarGradient,
    Gradient? sageAvatarGradient,
    Gradient? agentAvatarGradient,
    Gradient? topSectionGradient,
  }) => AppColors(
    success: success ?? this.success,
    warning: warning ?? this.warning,
    accent: accent ?? this.accent,
    huddleDrawerSurface: huddleDrawerSurface ?? this.huddleDrawerSurface,
    huddleControlSurface: huddleControlSurface ?? this.huddleControlSurface,
    onHuddleDrawer: onHuddleDrawer ?? this.onHuddleDrawer,
    plum: plum ?? this.plum,
    lilac: lilac ?? this.lilac,
    apricot: apricot ?? this.apricot,
    identityPersonForeground:
        identityPersonForeground ?? this.identityPersonForeground,
    identitySageForeground:
        identitySageForeground ?? this.identitySageForeground,
    identityAgentForeground:
        identityAgentForeground ?? this.identityAgentForeground,
    identityPresence: identityPresence ?? this.identityPresence,
    companyWashGradient: companyWashGradient ?? this.companyWashGradient,
    personAvatarGradient: personAvatarGradient ?? this.personAvatarGradient,
    sageAvatarGradient: sageAvatarGradient ?? this.sageAvatarGradient,
    agentAvatarGradient: agentAvatarGradient ?? this.agentAvatarGradient,
    topSectionGradient: topSectionGradient ?? this.topSectionGradient,
  );

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      huddleDrawerSurface: Color.lerp(
        huddleDrawerSurface,
        other.huddleDrawerSurface,
        t,
      )!,
      huddleControlSurface: Color.lerp(
        huddleControlSurface,
        other.huddleControlSurface,
        t,
      )!,
      onHuddleDrawer: Color.lerp(onHuddleDrawer, other.onHuddleDrawer, t)!,
      plum: Color.lerp(plum, other.plum, t)!,
      lilac: Color.lerp(lilac, other.lilac, t)!,
      apricot: Color.lerp(apricot, other.apricot, t)!,
      identityPersonForeground: Color.lerp(
        identityPersonForeground,
        other.identityPersonForeground,
        t,
      )!,
      identitySageForeground: Color.lerp(
        identitySageForeground,
        other.identitySageForeground,
        t,
      )!,
      identityAgentForeground: Color.lerp(
        identityAgentForeground,
        other.identityAgentForeground,
        t,
      )!,
      identityPresence: Color.lerp(
        identityPresence,
        other.identityPresence,
        t,
      )!,
      companyWashGradient: Gradient.lerp(
        companyWashGradient,
        other.companyWashGradient,
        t,
      )!,
      personAvatarGradient: Gradient.lerp(
        personAvatarGradient,
        other.personAvatarGradient,
        t,
      )!,
      sageAvatarGradient: Gradient.lerp(
        sageAvatarGradient,
        other.sageAvatarGradient,
        t,
      )!,
      agentAvatarGradient: Gradient.lerp(
        agentAvatarGradient,
        other.agentAvatarGradient,
        t,
      )!,
      topSectionGradient: Gradient.lerp(
        topSectionGradient,
        other.topSectionGradient,
        t,
      ),
    );
  }
}
