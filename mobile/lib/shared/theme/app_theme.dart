import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'color_scheme.dart';
import 'grid.dart';
import 'mobile_design_tokens.dart';
import 'mobile_typography_tokens.dart';
import 'text_theme.dart';

/// Border radius constants matching desktop shadcn "New York" style.
/// Desktop uses --radius: 0.625rem (10px) as base:
///   lg = 10px, md = 8px, sm = 6px
class Radii {
  /// Small radius for compact UI elements.
  static const double xs = 4.0;
  static const double lg = 10.0;
  static const double md = 8.0;
  static const double sm = 6.0;

  /// Shared strong radius for grouped rows, fields, and utility containers.
  static const double container = 20.0;
  static const double card = container; // Backwards-compatible card alias.
  static const double companyCard = 18.0;
  static const double companyPinned = 13.0;
  static const double compactCard = 15.0;
  static const double field = 12.0;
  static const double button = 14.0;
  static const double tapTarget = 12.0;
  static const double sheet = 27.0;
  static const double phone = 36.0;
  static const double popover = 20.0;
  static const double dialog = 24.0; // desktop uses rounded-3xl for dialogs

  /// Fully rounds pills, circles, and other capsule shapes.
  static const double full = 999.0;
}

/// Shared motion timing used by mobile navigation and screen transitions.
abstract final class MotionTokens {
  /// Duration of the selected destination indicator transition.
  static const tabSelection = Duration(milliseconds: 180);
}

const _pageTransitionBuilders = <TargetPlatform, PageTransitionsBuilder>{
  TargetPlatform.android: _ReducedMotionPageTransitionsBuilder(
    PredictiveBackPageTransitionsBuilder(),
  ),
  TargetPlatform.iOS: _ReducedMotionPageTransitionsBuilder(
    CupertinoPageTransitionsBuilder(),
  ),
  TargetPlatform.macOS: _ReducedMotionPageTransitionsBuilder(
    CupertinoPageTransitionsBuilder(),
  ),
  TargetPlatform.windows: _ReducedMotionPageTransitionsBuilder(
    ZoomPageTransitionsBuilder(),
  ),
  TargetPlatform.linux: _ReducedMotionPageTransitionsBuilder(
    ZoomPageTransitionsBuilder(),
  ),
  TargetPlatform.fuchsia: _ReducedMotionPageTransitionsBuilder(
    ZoomPageTransitionsBuilder(),
  ),
};

class _ReducedMotionPageTransitionsBuilder extends PageTransitionsBuilder {
  const _ReducedMotionPageTransitionsBuilder(this.delegate);

  final PageTransitionsBuilder delegate;

  @override
  DelegatedTransitionBuilder? get delegatedTransition =>
      delegate.delegatedTransition;

  @override
  Duration get transitionDuration => delegate.transitionDuration;

  @override
  Duration get reverseTransitionDuration => delegate.reverseTransitionDuration;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    return delegate.buildTransitions(
      route,
      context,
      animation,
      secondaryAnimation,
      child,
    );
  }
}

class AppTheme {
  static const _companyWashGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0x1AD7B8E4), Color(0x1AEFCBB5)],
  );
  static const _personAvatarGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFFE4D5), Color(0xFFECC0A9)],
  );
  static const _sageAvatarGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFD8E9DF), Color(0xFFA9CEC1)],
  );
  static const _agentAvatarGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFE8D4F2), Color(0xFFBEA8DB)],
  );

  static ThemeData light({
    ColorScheme? colorScheme,
    Gradient? topSectionGradient,
    MobileDesignTokens? mobileTokens,
  }) {
    final scheme = colorScheme ?? lightColorScheme;
    final appColors = AppColors(
      success: const Color(0xFF40A02B), // Catppuccin Latte Green — universal
      warning: const Color(0xFFDF8E1D), // Latte Yellow
      accent: scheme.tertiary,
      huddleDrawerSurface: const Color(0xFF000000),
      huddleControlSurface: const Color(0xFF333333),
      onHuddleDrawer: const Color(0xFFFAFAFA),
      plum: const Color(0xFF4E2F63),
      lilac: const Color(0xFFC9B4E3),
      apricot: const Color(0xFFF7C5A9),
      identityPersonForeground: const Color(0xFF8C5549),
      identitySageForeground: const Color(0xFF315F53),
      identityAgentForeground: const Color(0xFF583775),
      identityPresence: const Color(0xFF64A28A),
      companyWashGradient: _companyWashGradient,
      personAvatarGradient: _personAvatarGradient,
      sageAvatarGradient: _sageAvatarGradient,
      agentAvatarGradient: _agentAvatarGradient,
      topSectionGradient: topSectionGradient,
    );

    return _buildTheme(
      scheme: scheme,
      appColors: appColors,
      brightness: Brightness.light,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      mobileTokens:
          mobileTokens ??
          (colorScheme == null
              ? MobileDesignTokens.light
              : MobileDesignTokens.fromColorScheme(scheme)),
    );
  }

  static ThemeData dark({
    ColorScheme? colorScheme,
    Gradient? topSectionGradient,
    MobileDesignTokens? mobileTokens,
  }) {
    final scheme = colorScheme ?? darkColorScheme;
    final appColors = AppColors(
      success: const Color(
        0xFFA6DA95,
      ), // Catppuccin Macchiato Green — universal
      warning: const Color(0xFFEED49F), // Macchiato Yellow
      accent: scheme.tertiary,
      huddleDrawerSurface: scheme.primaryContainer,
      huddleControlSurface: Color.alphaBlend(
        scheme.onPrimaryContainer.withValues(alpha: 0.18),
        scheme.primaryContainer,
      ),
      onHuddleDrawer: scheme.onPrimaryContainer,
      plum: const Color(0xFFD1ABEA),
      lilac: const Color(0xFFC9B4E3),
      apricot: const Color(0xFFF7C5A9),
      identityPersonForeground: const Color(0xFF8C5549),
      identitySageForeground: const Color(0xFF315F53),
      identityAgentForeground: const Color(0xFF583775),
      identityPresence: const Color(0xFF64A28A),
      companyWashGradient: _companyWashGradient,
      personAvatarGradient: _personAvatarGradient,
      sageAvatarGradient: _sageAvatarGradient,
      agentAvatarGradient: _agentAvatarGradient,
      topSectionGradient: topSectionGradient,
    );

    return _buildTheme(
      scheme: scheme,
      appColors: appColors,
      brightness: Brightness.dark,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      mobileTokens:
          mobileTokens ??
          (colorScheme == null
              ? MobileDesignTokens.dark
              : MobileDesignTokens.fromColorScheme(scheme)),
    );
  }

  static ThemeData _buildTheme({
    required ColorScheme scheme,
    required AppColors appColors,
    required Brightness brightness,
    required Brightness statusBarIconBrightness,
    required Brightness statusBarBrightness,
    required MobileDesignTokens mobileTokens,
  }) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: _pageTransitionBuilders,
      ),
      splashFactory: NoSplash.splashFactory,
      scaffoldBackgroundColor: mobileTokens.canvas,
      extensions: [appColors, mobileTokens, MobileTypographyTokens.v5],
      fontFamily: 'Manrope',
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: textTheme.titleMedium?.copyWith(
          color: scheme.onSurface,
        ),
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: statusBarIconBrightness,
          statusBarBrightness: statusBarBrightness,
        ),
      ),

      // Bottom navigation: clean style, no indicator pill
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        elevation: 0,
        indicatorColor: Colors.transparent,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return IconThemeData(color: mobileTokens.action, size: 24);
          }
          return IconThemeData(color: mobileTokens.muted, size: 24);
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return textTheme.labelSmall?.copyWith(
              color: mobileTokens.action,
              fontWeight: FontWeight.w600,
            );
          }
          return textTheme.labelSmall?.copyWith(color: mobileTokens.muted);
        }),
      ),

      // Buttons share the v5 plum fill and a generous touch target.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: appColors.plum,
          foregroundColor: mobileTokens.onAction,
          overlayColor: appColors.plum.withValues(alpha: 0.12),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: buttonTextStyle,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: appColors.plum,
          foregroundColor: mobileTokens.onAction,
          overlayColor: appColors.plum.withValues(alpha: 0.12),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: buttonTextStyle,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: mobileTokens.paper,
          foregroundColor: mobileTokens.action,
          overlayColor: mobileTokens.action.withValues(alpha: 0.08),
          side: BorderSide(color: mobileTokens.line, width: 1),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: buttonTextStyle,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: mobileTokens.action,
          overlayColor: mobileTokens.action.withValues(alpha: 0.08),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: buttonTextStyle,
        ),
      ),

      // Cards use a quiet paper surface with a hairline edge.
      cardTheme: CardThemeData(
        color: mobileTokens.paper,
        margin: EdgeInsets.zero,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.card),
          side: BorderSide(color: mobileTokens.line),
        ),
      ),

      // Inputs: desktop uses outlined style, rounded-md (8px), h-9 (36px)
      inputDecorationTheme: InputDecorationTheme(
        filled: false,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.field),
          borderSide: BorderSide(color: mobileTokens.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.field),
          borderSide: BorderSide(color: mobileTokens.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.field),
          borderSide: BorderSide(color: mobileTokens.action),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.field),
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.field),
          borderSide: BorderSide(color: scheme.error),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
        isDense: true,
      ),

      // Dialogs: desktop uses rounded-3xl (24px), custom overlay
      dialogTheme: DialogThemeData(
        backgroundColor: mobileTokens.paper,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.dialog),
          side: BorderSide(color: mobileTokens.line),
        ),
        titleTextStyle: textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.3,
        ),
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        strokeWidth: 2,
        color: mobileTokens.action,
        circularTrackColor: mobileTokens.soft,
      ),

      listTileTheme: ListTileThemeData(
        titleTextStyle: textTheme.titleSmall?.copyWith(color: mobileTokens.ink),
        subtitleTextStyle: textTheme.bodyMedium?.copyWith(
          color: mobileTokens.muted,
        ),
        iconColor: mobileTokens.action,
        contentPadding: const EdgeInsets.symmetric(horizontal: Grid.twelve),
        minVerticalPadding: Grid.twelve,
        horizontalTitleGap: Grid.twelve,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.md),
        ),
      ),

      // Chips: desktop uses rounded-sm (6px)
      chipTheme: ChipThemeData(
        labelStyle: textTheme.bodySmall?.copyWith(color: scheme.secondary),
        // M3 resolves the chip container via `color` (WidgetStateProperty);
        // `selectedColor` is the legacy M2 path and is ignored here. Selected
        // filter chips (Pulse/Search/Activity tabs) use the accent.
        color: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return mobileTokens.action;
          return mobileTokens.soft;
        }),
        checkmarkColor: mobileTokens.onAction,
        shape: RoundedRectangleBorder(
          side: BorderSide.none,
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        side: BorderSide.none,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        labelPadding: EdgeInsets.zero,
      ),

      // Popups/menus share the elevated 20px mobile popover treatment.
      popupMenuTheme: PopupMenuThemeData(
        color: mobileTokens.paper.withValues(alpha: 0.98),
        elevation: 8,
        shadowColor: scheme.shadow.withValues(alpha: 0.18),
        surfaceTintColor: Colors.transparent,
        textStyle: textTheme.labelLarge?.copyWith(color: scheme.onSurface),
        labelTextStyle: WidgetStatePropertyAll(
          textTheme.labelLarge?.copyWith(color: scheme.onSurface),
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.popover),
          side: BorderSide(color: mobileTokens.line),
        ),
      ),

      // Sheets share the raised paper surface and broader v5 corner.
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: mobileTokens.paper,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(Radii.sheet),
          ),
          side: BorderSide(color: mobileTokens.line),
        ),
      ),

      // Tooltips: desktop uses rounded-md, primary bg
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: appColors.plum,
          borderRadius: BorderRadius.circular(Radii.button),
        ),
        textStyle: textTheme.bodySmall?.copyWith(
          color: mobileTokens.onAction,
          fontSize: 12,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      ),

      dividerTheme: DividerThemeData(
        color: mobileTokens.line,
        thickness: 1,
        space: 1,
      ),

      // Snackbar
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: appColors.plum,
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: mobileTokens.onAction,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
    );
  }
}
