import 'package:flutter/cupertino.dart';
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
    expect(side.color, theme.extension<MobileDesignTokens>()!.line);
    expect(side.width, 1);
  });

  test('uses the shared compact Manrope style for every button family', () {
    final theme = AppTheme.light();
    final buttonStyles = [
      theme.elevatedButtonTheme.style!.textStyle!.resolve({})!,
      theme.filledButtonTheme.style!.textStyle!.resolve({})!,
      theme.outlinedButtonTheme.style!.textStyle!.resolve({})!,
      theme.textButtonTheme.style!.textStyle!.resolve({})!,
    ];

    expect(
      buttonStyles.map((style) => style.fontFamily),
      everyElement('Manrope'),
    );
    expect(buttonStyles.map((style) => style.fontSize), everyElement(12));
    expect(
      [
        theme.elevatedButtonTheme.style!,
        theme.filledButtonTheme.style!,
        theme.outlinedButtonTheme.style!,
        theme.textButtonTheme.style!,
      ].map((style) => style.minimumSize!.resolve({})!.height),
      everyElement(44),
    );
    expect(
      (theme.filledButtonTheme.style!.shape!.resolve({})!
              as RoundedRectangleBorder)
          .borderRadius,
      BorderRadius.circular(Radii.button),
    );
    expect(
      theme.filledButtonTheme.style!.overlayColor!.resolve({
        WidgetState.pressed,
      })!.a,
      closeTo(0.102, 0.001),
    );
  });

  testWidgets(
    'page entrance keeps native gestures and respects reduced motion',
    (tester) async {
      final theme = AppTheme.light().copyWith(platform: TargetPlatform.iOS);
      const routeChild = Text('Next page', key: ValueKey('next-page'));

      Widget appFor({required bool reduceMotion}) => MaterialApp(
        key: ValueKey(reduceMotion),
        theme: theme,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(disableAnimations: reduceMotion),
          child: child!,
        ),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              key: const ValueKey('open-next-page'),
              onPressed: () => Navigator.of(
                context,
              ).push<void>(MaterialPageRoute<void>(builder: (_) => routeChild)),
              child: const Text('Open next page'),
            ),
          ),
        ),
      );

      await tester.pumpWidget(appFor(reduceMotion: false));
      await tester.tap(find.byKey(const ValueKey('open-next-page')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(
        find.ancestor(
          of: find.byKey(const ValueKey('next-page')),
          matching: find.byType(CupertinoPageTransition),
        ),
        findsWidgets,
      );

      await tester.pumpWidget(appFor(reduceMotion: true));
      await tester.tap(find.byKey(const ValueKey('open-next-page')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byKey(const ValueKey('next-page')), findsOneWidget);
      expect(
        find.ancestor(
          of: find.byKey(const ValueKey('next-page')),
          matching: find.byType(CupertinoPageTransition),
        ),
        findsNothing,
      );
    },
  );

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

  test('exposes the v5 palette and named type roles beside legacy styles', () {
    final theme = AppTheme.light();
    final colors = theme.extension<MobileDesignTokens>()!;
    final typography = theme.extension<MobileTypographyTokens>()!;

    expect(colors.canvas, const Color(0xFFF7F4F8));
    expect(colors.paper, const Color(0xFFFFFDFD));
    expect(colors.brandBarDivider, const Color(0xFFE9E1ED));
    expect(colors.action, const Color(0xFF694180));
    expect(colors.onAction, const Color(0xFFFFFDFD));
    expect(theme.extension<AppColors>()!.plum, const Color(0xFF4E2F63));
    expect(theme.extension<AppColors>()!.lilac, const Color(0xFFC9B4E3));
    expect(theme.extension<AppColors>()!.apricot, const Color(0xFFF7C5A9));
    expect(typography.body.fontSize, 14);
    expect(typography.body.height, 1.5);
    expect(typography.conversation.fontSize, 13);
    expect(typography.conversation.height, 1.6);
    expect(typography.metadata.fontSize, 11);
    expect(typography.navigationLabel.fontSize, 9);
    expect(typography.flowTitle.fontSize, 28);
    expect(typography.onboardingTitle.fontSize, 37);
    expect(typography.companyHubTitle.fontSize, 20);
    expect(typography.identityInitials.fontSize, 12);
    expect(typography.maximumWeight, FontWeight.w800);
    expect(theme.textTheme.displaySmall?.fontSize, 36);
    expect(theme.scaffoldBackgroundColor, colors.canvas);
    expect(
      theme.progressIndicatorTheme.color,
      theme.extension<MobileDesignTokens>()!.action,
    );
    expect(
      (theme.cardTheme.shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(Radii.card),
    );
    expect(
      (theme.bottomSheetTheme.shape! as RoundedRectangleBorder).borderRadius
          .resolve(TextDirection.ltr)
          .topLeft,
      Radius.circular(Radii.sheet),
    );
  });
}
