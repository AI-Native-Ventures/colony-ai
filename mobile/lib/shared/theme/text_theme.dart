import 'package:flutter/material.dart';

const _fontFamily = 'Manrope';
const _chatLineHeight = 22 / 16;

/// Optional 12sp body style for compact secondary metadata.
const bodyExtraSmallTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w400,
  height: 1.25,
  letterSpacing: 0,
);

const buttonTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w700,
  height: 1.2,
  letterSpacing: 0,
);

const companyHubTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 20,
  fontWeight: FontWeight.w700,
  height: 1.3,
  letterSpacing: -0.6,
);

const companyHubSubtitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 10,
  fontWeight: FontWeight.w400,
  height: 1.4,
);

const companySectionTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 10,
  fontWeight: FontWeight.w800,
  height: 1.3,
  letterSpacing: 0.8,
);

const companyEntryTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w700,
  height: 1.2,
);

const companyEntryDescriptionTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 9,
  fontWeight: FontWeight.w400,
  height: 1.2,
);

const goalCardTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 15,
  fontWeight: FontWeight.w700,
  height: 1.55,
  letterSpacing: -0.4,
);

const goalCardChipTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 9,
  fontWeight: FontWeight.w700,
  height: 1.4,
);

const goalReferenceLabelTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 10,
  fontWeight: FontWeight.w400,
  height: 1.6,
);

const goalReferenceTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 11,
  fontWeight: FontWeight.w700,
  height: 1.6,
);

const goalSectionTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 15,
  fontWeight: FontWeight.w700,
  height: 1.3,
  letterSpacing: -0.35,
);

const goalDetailTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 23,
  fontWeight: FontWeight.w700,
  height: 1.4,
  letterSpacing: -0.8,
);

const goalMetricTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 26,
  fontWeight: FontWeight.w700,
  height: 1.2,
  letterSpacing: -0.7,
);

const goalBodyTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w400,
  height: 1.9,
  letterSpacing: 0,
);

/// Typography for labels in the goal create and progress sheets.
const goalFormLabelTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 11,
  fontWeight: FontWeight.w700,
  height: 1.25,
  letterSpacing: 0,
);

/// Typography for values and hints in the goal form controls.
const goalFormControlTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 13,
  fontWeight: FontWeight.w700,
  height: 1.2,
  letterSpacing: 0,
);

/// Typography for left-aligned titles in mobile sheets.
const sheetHeaderTitleTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 20,
  fontWeight: FontWeight.w700,
  height: 1.4,
  letterSpacing: -0.15,
);

const identityInitialsTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w800,
  height: 1,
);

const identityNameTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 12,
  fontWeight: FontWeight.w700,
  height: 1.35,
);

const identityDetailsTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 10,
  fontWeight: FontWeight.w400,
  height: 1.4,
);

const identityStatusTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 8,
  fontWeight: FontWeight.w500,
  height: 1.35,
);

const brandWordmarkTextStyle = TextStyle(
  fontFamily: _fontFamily,
  fontSize: 22,
  fontWeight: FontWeight.w700,
  height: 1.2,
  letterSpacing: -1.4,
);

const textTheme = TextTheme(
  displayLarge: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 52,
    fontWeight: FontWeight.w400,
    height: 1.23,
    letterSpacing: 0,
  ),
  displayMedium: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 44,
    fontWeight: FontWeight.w400,
    height: 1.18,
    letterSpacing: 0,
  ),
  displaySmall: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 36,
    fontWeight: FontWeight.w400,
    height: 1.22,
    letterSpacing: 0,
  ),
  headlineLarge: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 32,
    fontWeight: FontWeight.w600,
    height: 1.25,
    letterSpacing: 0,
  ),
  headlineMedium: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 28,
    fontWeight: FontWeight.w600,
    height: 1.29,
    letterSpacing: 0,
  ),
  headlineSmall: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 24,
    fontWeight: FontWeight.w600,
    height: 1.33,
    letterSpacing: 0,
  ),
  titleLarge: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 24,
    fontWeight: FontWeight.w400,
    height: 1.25,
    letterSpacing: 0,
  ),
  titleMedium: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 20,
    fontWeight: FontWeight.w500,
    height: 1.3,
    letterSpacing: 0,
  ),
  titleSmall: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w500,
    height: _chatLineHeight,
    letterSpacing: 0,
  ),
  labelLarge: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w500,
    height: 1.2,
    letterSpacing: 0,
  ),
  labelMedium: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w500,
    height: 1.25,
    letterSpacing: 0,
  ),
  labelSmall: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w500,
    height: 1.2,
    letterSpacing: 0,
  ),
  bodyLarge: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 20 / 16,
    letterSpacing: 0,
  ),
  bodyMedium: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.3,
    letterSpacing: 0,
  ),
  bodySmall: TextStyle(
    fontFamily: _fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.25,
    letterSpacing: 0,
  ),
);
