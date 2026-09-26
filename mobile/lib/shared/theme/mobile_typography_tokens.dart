import 'package:flutter/material.dart';

/// Named Manrope text roles from the r16 mobile typography contract.
@immutable
class MobileTypographyTokens extends ThemeExtension<MobileTypographyTokens> {
  const MobileTypographyTokens({
    required this.body,
    required this.conversation,
    required this.metadata,
    required this.navigationLabel,
    required this.flowTitle,
    required this.onboardingTitle,
    required this.maximumWeight,
  });

  static const r16 = MobileTypographyTokens(
    body: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 14,
      fontWeight: FontWeight.w400,
      height: 1.5,
    ),
    conversation: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 13,
      fontWeight: FontWeight.w400,
      height: 1.6,
    ),
    metadata: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 11,
      fontWeight: FontWeight.w400,
      height: 1.25,
    ),
    navigationLabel: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 9,
      fontWeight: FontWeight.w400,
      height: 1.2,
    ),
    flowTitle: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 28,
      fontWeight: FontWeight.w600,
      height: 1.22,
      letterSpacing: -0.84,
    ),
    onboardingTitle: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 37,
      fontWeight: FontWeight.w400,
      height: 1.16,
      letterSpacing: -1.48,
    ),
    maximumWeight: FontWeight.w800,
  );

  final TextStyle body;
  final TextStyle conversation;
  final TextStyle metadata;
  final TextStyle navigationLabel;
  final TextStyle flowTitle;
  final TextStyle onboardingTitle;
  final FontWeight maximumWeight;

  @override
  MobileTypographyTokens copyWith({
    TextStyle? body,
    TextStyle? conversation,
    TextStyle? metadata,
    TextStyle? navigationLabel,
    TextStyle? flowTitle,
    TextStyle? onboardingTitle,
    FontWeight? maximumWeight,
  }) => MobileTypographyTokens(
    body: body ?? this.body,
    conversation: conversation ?? this.conversation,
    metadata: metadata ?? this.metadata,
    navigationLabel: navigationLabel ?? this.navigationLabel,
    flowTitle: flowTitle ?? this.flowTitle,
    onboardingTitle: onboardingTitle ?? this.onboardingTitle,
    maximumWeight: maximumWeight ?? this.maximumWeight,
  );

  @override
  MobileTypographyTokens lerp(
    ThemeExtension<MobileTypographyTokens>? other,
    double t,
  ) {
    if (other is! MobileTypographyTokens) return this;
    return MobileTypographyTokens(
      body: TextStyle.lerp(body, other.body, t)!,
      conversation: TextStyle.lerp(conversation, other.conversation, t)!,
      metadata: TextStyle.lerp(metadata, other.metadata, t)!,
      navigationLabel: TextStyle.lerp(
        navigationLabel,
        other.navigationLabel,
        t,
      )!,
      flowTitle: TextStyle.lerp(flowTitle, other.flowTitle, t)!,
      onboardingTitle: TextStyle.lerp(
        onboardingTitle,
        other.onboardingTitle,
        t,
      )!,
      maximumWeight: t < 0.5 ? maximumWeight : other.maximumWeight,
    );
  }
}
