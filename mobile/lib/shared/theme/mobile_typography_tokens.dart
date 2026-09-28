import 'package:flutter/material.dart';

import 'text_theme.dart';

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
    required this.companyHubTitle,
    required this.companyHubSubtitle,
    required this.companySection,
    required this.companyEntryTitle,
    required this.companyEntryDescription,
    required this.goalCardTitle,
    required this.goalSectionTitle,
    required this.goalDetailTitle,
    required this.goalMetric,
    required this.goalBody,
    required this.goalFormLabel,
    required this.goalFormControl,
    required this.identityInitials,
    required this.identityName,
    required this.identityDetails,
    required this.identityStatus,
    required this.brandWordmark,
  });

  static const v5 = MobileTypographyTokens(
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
    companyHubTitle: companyHubTitleTextStyle,
    companyHubSubtitle: companyHubSubtitleTextStyle,
    companySection: companySectionTextStyle,
    companyEntryTitle: companyEntryTitleTextStyle,
    companyEntryDescription: companyEntryDescriptionTextStyle,
    goalCardTitle: goalCardTitleTextStyle,
    goalSectionTitle: goalSectionTitleTextStyle,
    goalDetailTitle: goalDetailTitleTextStyle,
    goalMetric: goalMetricTextStyle,
    goalBody: goalBodyTextStyle,
    goalFormLabel: goalFormLabelTextStyle,
    goalFormControl: goalFormControlTextStyle,
    identityInitials: identityInitialsTextStyle,
    identityName: identityNameTextStyle,
    identityDetails: identityDetailsTextStyle,
    identityStatus: identityStatusTextStyle,
    brandWordmark: brandWordmarkTextStyle,
  );

  static const r16 = v5;

  final TextStyle body;
  final TextStyle conversation;
  final TextStyle metadata;
  final TextStyle navigationLabel;
  final TextStyle flowTitle;
  final TextStyle onboardingTitle;
  final FontWeight maximumWeight;

  /// Typography for the Company hub title.
  final TextStyle companyHubTitle;

  /// Typography for the active workspace name in the Company hub.
  final TextStyle companyHubSubtitle;

  /// Typography for Company hub section labels.
  final TextStyle companySection;

  /// Typography for Company hub destination names.
  final TextStyle companyEntryTitle;

  /// Typography for Company hub destination descriptions.
  final TextStyle companyEntryDescription;

  /// Typography for goal cards in the Company Goals view.
  final TextStyle goalCardTitle;

  /// Typography for goal section headings.
  final TextStyle goalSectionTitle;

  /// Typography for a goal title inside its gradient hero.
  final TextStyle goalDetailTitle;

  /// Typography for the current progress value in a goal hero.
  final TextStyle goalMetric;

  /// Typography for goal descriptions and done conditions.
  final TextStyle goalBody;

  /// Typography for labels in goal form sheets.
  final TextStyle goalFormLabel;

  /// Typography for values and hints in goal form controls.
  final TextStyle goalFormControl;

  /// Typography for identity initials.
  final TextStyle identityInitials;

  /// Typography for person and agent names.
  final TextStyle identityName;

  /// Typography for person and agent details.
  final TextStyle identityDetails;

  /// Typography for person and agent status.
  final TextStyle identityStatus;

  /// Typography for the optional shared shell wordmark.
  final TextStyle brandWordmark;

  @override
  MobileTypographyTokens copyWith({
    TextStyle? body,
    TextStyle? conversation,
    TextStyle? metadata,
    TextStyle? navigationLabel,
    TextStyle? flowTitle,
    TextStyle? onboardingTitle,
    FontWeight? maximumWeight,
    TextStyle? companyHubTitle,
    TextStyle? companyHubSubtitle,
    TextStyle? companySection,
    TextStyle? companyEntryTitle,
    TextStyle? companyEntryDescription,
    TextStyle? goalCardTitle,
    TextStyle? goalSectionTitle,
    TextStyle? goalDetailTitle,
    TextStyle? goalMetric,
    TextStyle? goalBody,
    TextStyle? goalFormLabel,
    TextStyle? goalFormControl,
    TextStyle? identityInitials,
    TextStyle? identityName,
    TextStyle? identityDetails,
    TextStyle? identityStatus,
    TextStyle? brandWordmark,
  }) => MobileTypographyTokens(
    body: body ?? this.body,
    conversation: conversation ?? this.conversation,
    metadata: metadata ?? this.metadata,
    navigationLabel: navigationLabel ?? this.navigationLabel,
    flowTitle: flowTitle ?? this.flowTitle,
    onboardingTitle: onboardingTitle ?? this.onboardingTitle,
    maximumWeight: maximumWeight ?? this.maximumWeight,
    companyHubTitle: companyHubTitle ?? this.companyHubTitle,
    companyHubSubtitle: companyHubSubtitle ?? this.companyHubSubtitle,
    companySection: companySection ?? this.companySection,
    companyEntryTitle: companyEntryTitle ?? this.companyEntryTitle,
    companyEntryDescription:
        companyEntryDescription ?? this.companyEntryDescription,
    goalCardTitle: goalCardTitle ?? this.goalCardTitle,
    goalSectionTitle: goalSectionTitle ?? this.goalSectionTitle,
    goalDetailTitle: goalDetailTitle ?? this.goalDetailTitle,
    goalMetric: goalMetric ?? this.goalMetric,
    goalBody: goalBody ?? this.goalBody,
    goalFormLabel: goalFormLabel ?? this.goalFormLabel,
    goalFormControl: goalFormControl ?? this.goalFormControl,
    identityInitials: identityInitials ?? this.identityInitials,
    identityName: identityName ?? this.identityName,
    identityDetails: identityDetails ?? this.identityDetails,
    identityStatus: identityStatus ?? this.identityStatus,
    brandWordmark: brandWordmark ?? this.brandWordmark,
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
      companyHubTitle: TextStyle.lerp(
        companyHubTitle,
        other.companyHubTitle,
        t,
      )!,
      companyHubSubtitle: TextStyle.lerp(
        companyHubSubtitle,
        other.companyHubSubtitle,
        t,
      )!,
      companySection: TextStyle.lerp(companySection, other.companySection, t)!,
      companyEntryTitle: TextStyle.lerp(
        companyEntryTitle,
        other.companyEntryTitle,
        t,
      )!,
      companyEntryDescription: TextStyle.lerp(
        companyEntryDescription,
        other.companyEntryDescription,
        t,
      )!,
      goalCardTitle: TextStyle.lerp(goalCardTitle, other.goalCardTitle, t)!,
      goalSectionTitle: TextStyle.lerp(
        goalSectionTitle,
        other.goalSectionTitle,
        t,
      )!,
      goalDetailTitle: TextStyle.lerp(
        goalDetailTitle,
        other.goalDetailTitle,
        t,
      )!,
      goalMetric: TextStyle.lerp(goalMetric, other.goalMetric, t)!,
      goalBody: TextStyle.lerp(goalBody, other.goalBody, t)!,
      goalFormLabel: TextStyle.lerp(goalFormLabel, other.goalFormLabel, t)!,
      goalFormControl: TextStyle.lerp(
        goalFormControl,
        other.goalFormControl,
        t,
      )!,
      identityInitials: TextStyle.lerp(
        identityInitials,
        other.identityInitials,
        t,
      )!,
      identityName: TextStyle.lerp(identityName, other.identityName, t)!,
      identityDetails: TextStyle.lerp(
        identityDetails,
        other.identityDetails,
        t,
      )!,
      identityStatus: TextStyle.lerp(identityStatus, other.identityStatus, t)!,
      brandWordmark: TextStyle.lerp(brandWordmark, other.brandWordmark, t)!,
    );
  }
}
