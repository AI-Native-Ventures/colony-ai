import 'package:flutter/material.dart';

import 'color_scheme.dart';

/// Semantic colors and geometry from the approved mobile references.
@immutable
class MobileDesignTokens extends ThemeExtension<MobileDesignTokens> {
  const MobileDesignTokens({
    required this.canvas,
    required this.paper,
    required this.ink,
    required this.muted,
    required this.line,
    required this.brandBarDivider,
    required this.soft,
    required this.action,
    required this.onAction,
    required this.flowAction,
    required this.flowActionForeground,
    required this.actionSoft,
    required this.onActionSoft,
    required this.info,
    required this.success,
    required this.warning,
    required this.error,
  });

  final Color canvas;
  final Color paper;
  final Color ink;
  final Color muted;
  final Color line;
  final Color brandBarDivider;
  final Color soft;
  final Color action;

  /// Foreground color for content placed on [action].
  final Color onAction;

  /// Primary color retained by profile and settings flows on the r19 design.
  final Color flowAction;

  /// Foreground color for profile and settings flow actions.
  final Color flowActionForeground;
  final Color actionSoft;
  final Color onActionSoft;
  final Color info;
  final Color success;
  final Color warning;
  final Color error;

  static const light = MobileDesignTokens(
    canvas: Color(0xFFF7F4F8),
    paper: Color(0xFFFFFDFD),
    ink: Color(0xFF34263C),
    muted: Color(0xFF8C8093),
    line: Color(0xFFE9E1ED),
    brandBarDivider: Color(0xFFE9E1ED),
    soft: Color(0xFFEEE7F2),
    action: Color(0xFF694180),
    onAction: Color(0xFFFFFDFD),
    flowAction: Color(0xFF45669F),
    flowActionForeground: Color(0xFFFFFFFF),
    actionSoft: Color(0xFFEEE7F2),
    onActionSoft: Color(0xFF694180),
    info: Color(0xFFEAE3F0),
    success: Color(0xFFE5F0EA),
    warning: Color(0xFFF7EBDD),
    error: Color(0xFFF5E4E8),
  );

  static const dark = MobileDesignTokens(
    canvas: Color(0xFF201927),
    paper: Color(0xFF2B2233),
    ink: Color(0xFFF2E9F6),
    muted: Color(0xFFB3A2BD),
    line: Color(0xFF41334C),
    brandBarDivider: Color(0xFF41334C),
    soft: Color(0xFF382B43),
    action: Color(0xFFD1ABEA),
    onAction: Color(0xFF201927),
    flowAction: Color(0xFF45669F),
    flowActionForeground: Color(0xFFFFFFFF),
    actionSoft: Color(0xFF382B43),
    onActionSoft: Color(0xFFD1ABEA),
    info: Color(0xFF382B43),
    success: Color(0xFF294137),
    warning: Color(0xFF4A372D),
    error: Color(0xFF4A2E3A),
  );

  /// Adapts r16 surfaces to a user-selected theme while retaining its accent.
  factory MobileDesignTokens.fromColorScheme(ColorScheme scheme) {
    final defaults = scheme.brightness == Brightness.dark ? dark : light;
    return defaults.copyWith(
      canvas: scheme.surfaceContainerLow,
      paper: scheme.surface,
      ink: scheme.onSurface,
      muted: scheme.onSurfaceVariant,
      line: scheme.outlineVariant,
      brandBarDivider: scheme.outlineVariant,
      soft: scheme.surfaceContainerHighest,
      action: scheme.primary,
      onAction: scheme.onPrimary,
      flowAction: scheme.primary,
      flowActionForeground: contrastForeground(scheme.primary),
      actionSoft: scheme.primaryContainer,
      onActionSoft: scheme.onPrimaryContainer,
      error: scheme.errorContainer,
    );
  }

  @override
  MobileDesignTokens copyWith({
    Color? canvas,
    Color? paper,
    Color? ink,
    Color? muted,
    Color? line,
    Color? brandBarDivider,
    Color? soft,
    Color? action,
    Color? onAction,
    Color? flowAction,
    Color? flowActionForeground,
    Color? actionSoft,
    Color? onActionSoft,
    Color? info,
    Color? success,
    Color? warning,
    Color? error,
  }) => MobileDesignTokens(
    canvas: canvas ?? this.canvas,
    paper: paper ?? this.paper,
    ink: ink ?? this.ink,
    muted: muted ?? this.muted,
    line: line ?? this.line,
    brandBarDivider: brandBarDivider ?? this.brandBarDivider,
    soft: soft ?? this.soft,
    action: action ?? this.action,
    onAction: onAction ?? this.onAction,
    flowAction: flowAction ?? this.flowAction,
    flowActionForeground: flowActionForeground ?? this.flowActionForeground,
    actionSoft: actionSoft ?? this.actionSoft,
    onActionSoft: onActionSoft ?? this.onActionSoft,
    info: info ?? this.info,
    success: success ?? this.success,
    warning: warning ?? this.warning,
    error: error ?? this.error,
  );

  @override
  MobileDesignTokens lerp(ThemeExtension<MobileDesignTokens>? other, double t) {
    if (other is! MobileDesignTokens) return this;
    return MobileDesignTokens(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      paper: Color.lerp(paper, other.paper, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      brandBarDivider: Color.lerp(brandBarDivider, other.brandBarDivider, t)!,
      soft: Color.lerp(soft, other.soft, t)!,
      action: Color.lerp(action, other.action, t)!,
      onAction: Color.lerp(onAction, other.onAction, t)!,
      flowAction: Color.lerp(flowAction, other.flowAction, t)!,
      flowActionForeground: Color.lerp(
        flowActionForeground,
        other.flowActionForeground,
        t,
      )!,
      actionSoft: Color.lerp(actionSoft, other.actionSoft, t)!,
      onActionSoft: Color.lerp(onActionSoft, other.onActionSoft, t)!,
      info: Color.lerp(info, other.info, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      error: Color.lerp(error, other.error, t)!,
    );
  }
}

/// Fixed phone-shell dimensions from the r16 mobile reference.
abstract final class MobileLayoutTokens {
  static const statusBarHeight = 46.0;
  static const brandBarHeight = 54.0;
  static const appBarHeight = 66.0;

  /// Height of the Company hub header beneath the status bar.
  static const companyHeaderHeight = 70.0;

  /// Size of the workspace identity in the Company hub header.
  static const companyHeaderAvatarSize = 40.0;
  static const bottomNavigationHeight = 59.0;
  static const minimumTapTarget = 44.0;
  static const minimumRowHeight = 64.0;
  static const conversationSearchIconSize = 17.0;
  static const conversationUnreadBadgeSize = 19.0;
  static const contentGutter = 20.0;
  static const scrollTopPadding = 22.0;
  static const scrollBottomPadding = 28.0;

  /// Margin between Company hub sections.
  static const companySectionMargin = 23.0;

  /// Gap between a Company hub section title and its cards.
  static const companySectionTitleGap = 10.0;

  /// Spacing between Company hub cards.
  static const companyGridGap = 10.0;

  /// Height of a Company hub destination card.
  static const companyCardHeight = 119.0;

  /// Interior padding for a Company hub destination card.
  static const companyCardPadding = 17.0;

  /// Icon size within a Company hub destination card.
  static const companyCardIconSize = 18.0;

  /// Padding around an icon within a Company hub destination card.
  static const companyCardIconPadding = 8.0;

  /// Gap between content items within a Company hub destination card.
  static const companyCardContentGap = 12.0;

  /// Gap between title and workspace name in the Company hub header.
  static const companySubtitleGap = 3.0;
}
