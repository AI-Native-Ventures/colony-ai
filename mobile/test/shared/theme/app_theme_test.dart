import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/shared/theme/app_colors.dart';
import 'package:buzz/shared/theme/app_theme.dart';
import 'package:buzz/shared/theme/mobile_design_tokens.dart';
import 'package:buzz/shared/theme/mobile_typography_tokens.dart';

void main() {
  test('disables Material touch ripples in every app theme', () {
    expect(AppTheme.light().splashFactory, NoSplash.splashFactory);
    expect(AppTheme.dark().splashFactory, NoSplash.splashFactory);
  });

  test('uses Manrope and the shared elevated popover treatment', () {
    final theme = AppTheme.light();
    final popupTheme = theme.popupMenuTheme;
    final shape = popupTheme.shape! as RoundedRectangleBorder;
    final side = shape.side;

    expect(popupTheme.textStyle?.fontFamily, 'Manrope');
    expect(popupTheme.elevation, 8);
    expect(
      popupTheme.shadowColor,
      theme.colorScheme.shadow.withValues(alpha: 0.18),
    );
    expect(shape.borderRadius, BorderRadius.circular(Radii.popover));
    expect(side.color, Colors.black.withValues(alpha: 0.04));
    expect(side.width, 1);
  });

  test('keeps inactive Huddle controls distinct in dark mode', () {
    final colors = AppTheme.dark().extension<AppColors>()!;

    expect(colors.huddleControlSurface, isNot(colors.huddleDrawerSurface));
    expect(
      (colors.huddleControlSurface.computeLuminance() -
              colors.huddleDrawerSurface.computeLuminance())
          .abs(),
      greaterThan(0.02),
    );
  });

  test('exposes the r16 palette and named type roles beside legacy styles', () {
    final theme = AppTheme.light();
    final colors = theme.extension<MobileDesignTokens>()!;
    final typography = theme.extension<MobileTypographyTokens>()!;

    expect(colors.canvas, const Color(0xFFEFEDF1));
    expect(colors.paper, const Color(0xFFFFFEFD));
    expect(colors.brandBarDivider, const Color(0xFFDCD7E1));
    expect(colors.action, const Color(0xFF345C99));
    expect(typography.body.fontSize, 14);
    expect(typography.body.height, 1.5);
    expect(typography.conversation.fontSize, 13);
    expect(typography.conversation.height, 1.6);
    expect(typography.metadata.fontSize, 11);
    expect(typography.navigationLabel.fontSize, 9);
    expect(typography.flowTitle.fontSize, 28);
    expect(typography.onboardingTitle.fontSize, 37);
    expect(typography.maximumWeight, FontWeight.w800);
    expect(theme.textTheme.displaySmall?.fontSize, 36);
  });
}
