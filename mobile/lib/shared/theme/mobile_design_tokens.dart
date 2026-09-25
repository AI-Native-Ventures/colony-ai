import 'package:flutter/material.dart';

/// Semantic colors and geometry from the approved r16 mobile reference.
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
  final Color actionSoft;
  final Color onActionSoft;
  final Color info;
  final Color success;
  final Color warning;
  final Color error;

  static const light = MobileDesignTokens(
    canvas: Color(0xFFEFEDF1),
    paper: Color(0xFFFFFEFD),
    ink: Color(0xFF292632),
    muted: Color(0xFF8B8590),
    line: Color(0xFFEEEBEE),
    brandBarDivider: Color(0xFFDCD7E1),
    soft: Color(0xFFF6F4F6),
    action: Color(0xFF345C99),
    actionSoft: Color(0xFFDFE8F8),
    onActionSoft: Color(0xFF345C99),
    info: Color(0xFFEAF0F6),
    success: Color(0xFFEAF2E9),
    warning: Color(0xFFF6EFE1),
    error: Color(0xFFF9EAF0),
  );

  static const dark = MobileDesignTokens(
    canvas: Color(0xFF25222C),
    paper: Color(0xFF25222C),
    ink: Color(0xFFEEE8F0),
    muted: Color(0xFFAAA1B1),
    line: Color(0xFF3A3342),
    brandBarDivider: Color(0xFF3A3342),
    soft: Color(0xFF312B38),
    action: Color(0xFFA1BCE9),
    actionSoft: Color(0xFFDFE8F8),
    onActionSoft: Color(0xFFA1BCE9),
    info: Color(0xFF34404A),
    success: Color(0xFF34404A),
    warning: Color(0xFF443A2D),
    error: Color(0xFF492F3B),
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
  static const bottomNavigationHeight = 55.0;
  static const minimumTapTarget = 44.0;
  static const minimumRowHeight = 64.0;
  static const contentGutter = 20.0;
  static const scrollTopPadding = 22.0;
  static const scrollBottomPadding = 28.0;
}
