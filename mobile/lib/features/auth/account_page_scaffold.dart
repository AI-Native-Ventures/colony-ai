import 'package:flutter/material.dart';

import 'account_flow_palette.dart';
import '../../shared/theme/theme.dart';

/// A compact, theme-native scaffold for the account forms.
class AccountPageScaffold extends StatelessWidget {
  const AccountPageScaffold({
    this.title,
    this.description,
    this.children = const [],
    this.footer,
    this.titleTopSpacing = 12,
    this.titleDescriptionSpacing = Grid.xs,
    this.descriptionChildrenSpacing = 22,
    this.footerBottomPadding = 8,
    this.showBackButton = true,
    this.showBrandBar = true,
    this.showHeroBackground = false,
    this.onBack,
    this.topLabel,
    super.key,
  });

  final String? title;
  final String? description;
  final List<Widget> children;
  final Widget? footer;

  /// Space before the account page title.
  final double titleTopSpacing;

  /// Space between the title and its description.
  final double titleDescriptionSpacing;

  /// Space after a title and description before the page contents.
  final double descriptionChildrenSpacing;
  final double footerBottomPadding;
  final bool showBackButton;
  final bool showBrandBar;
  final bool showHeroBackground;
  final VoidCallback? onBack;
  final String? topLabel;

  @override
  Widget build(BuildContext context) {
    final accountTheme = _accountTheme(Theme.of(context));
    return Theme(
      data: accountTheme,
      child: Builder(
        builder: (context) {
          final brightness = Theme.of(context).brightness;
          final paper = AccountFlowPalette.paper(brightness);
          final line = AccountFlowPalette.line(brightness);
          return Scaffold(
            backgroundColor: paper,
            appBar: showBrandBar
                ? AppBar(
                    toolbarHeight: 66,
                    centerTitle: false,
                    titleSpacing: showBackButton ? 0 : Grid.gutter,
                    leadingWidth: showBackButton ? 68 : 0,
                    leading: showBackButton
                        ? IconButton(
                            tooltip: 'Back',
                            onPressed:
                                onBack ??
                                () => Navigator.of(context).maybePop(),
                            icon: Transform.translate(
                              offset: Offset(5, 0),
                              child: const Icon(
                                Icons.arrow_back_ios_new,
                                size: 18,
                              ),
                            ),
                          )
                        : null,
                    title: Text(
                      'colony',
                      style: context.textTheme.titleLarge?.copyWith(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.4,
                      ),
                    ),
                    shape: Border(bottom: BorderSide(color: line)),
                  )
                : null,
            body: Column(
              children: [
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ColoredBox(color: paper),
                      if (showHeroBackground) const _AccountHeroBackground(),
                      SafeArea(
                        top: !showBrandBar,
                        bottom: footer == null,
                        child: SingleChildScrollView(
                          padding: EdgeInsets.fromLTRB(
                            20,
                            showHeroBackground ? 30 : 22,
                            20,
                            28,
                          ),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 440),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (topLabel != null) ...[
                                  Text(
                                    topLabel!.toUpperCase(),
                                    style: context.textTheme.labelSmall
                                        ?.copyWith(
                                          fontSize: 10,
                                          color:
                                              context.colors.onSurfaceVariant,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 1.5,
                                        ),
                                  ),
                                  const SizedBox(height: Grid.sm),
                                ],
                                if (title != null) ...[
                                  SizedBox(height: titleTopSpacing),
                                  Semantics(
                                    header: true,
                                    child: Text(
                                      title!,
                                      style: context.textTheme.headlineMedium
                                          ?.copyWith(
                                            fontSize: 28,
                                            fontWeight: FontWeight.w700,
                                            letterSpacing: -1.1,
                                            height: 1.13,
                                          ),
                                    ),
                                  ),
                                  if (description != null) ...[
                                    SizedBox(height: titleDescriptionSpacing),
                                    Text(
                                      description!,
                                      style: context.textTheme.bodyMedium
                                          ?.copyWith(
                                            fontSize: 13,
                                            color:
                                                context.colors.onSurfaceVariant,
                                            height: 1.7,
                                          ),
                                    ),
                                  ],
                                  SizedBox(height: descriptionChildrenSpacing),
                                ],
                                ...children,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (footer != null)
                  SafeArea(
                    top: false,
                    child: Container(
                      width: double.infinity,
                      padding: EdgeInsets.fromLTRB(
                        16,
                        12,
                        16,
                        footerBottomPadding,
                      ),
                      decoration: BoxDecoration(
                        color: paper,
                        border: Border(top: BorderSide(color: line)),
                      ),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 440),
                        child: footer,
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

ThemeData _accountTheme(ThemeData base) {
  final brightness = base.brightness;
  final paper = AccountFlowPalette.paper(brightness);
  final ink = AccountFlowPalette.ink(brightness);
  final muted = AccountFlowPalette.muted(brightness);
  final line = AccountFlowPalette.line(brightness);
  final soft = AccountFlowPalette.soft(brightness);
  final blue = AccountFlowPalette.blue(brightness);
  const action = AccountFlowPalette.action;
  final error = AccountFlowPalette.error(brightness);
  final errorContainer = AccountFlowPalette.errorContainer(brightness);
  final onErrorContainer = AccountFlowPalette.onErrorContainer(brightness);
  final colorScheme = base.colorScheme.copyWith(
    primary: blue,
    onPrimary: Colors.white,
    secondary: blue,
    onSecondary: Colors.white,
    error: error,
    onError: Colors.white,
    surface: paper,
    onSurface: ink,
    surfaceContainerLowest: paper,
    surfaceContainerLow: soft,
    surfaceContainer: soft,
    surfaceContainerHigh: soft,
    surfaceContainerHighest: soft,
    onSurfaceVariant: muted,
    outline: line,
    outlineVariant: line,
    errorContainer: errorContainer,
    onErrorContainer: onErrorContainer,
  );

  return base.copyWith(
    colorScheme: colorScheme,
    scaffoldBackgroundColor: paper,
    textTheme: base.textTheme.apply(
      bodyColor: ink,
      displayColor: ink,
      fontFamily: 'Manrope',
    ),
    appBarTheme: base.appBarTheme.copyWith(
      backgroundColor: paper,
      foregroundColor: ink,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: action,
        foregroundColor: Colors.white,
        disabledBackgroundColor: action.withValues(alpha: 0.45),
        disabledForegroundColor: Colors.white.withValues(alpha: 0.45),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        minimumSize: const Size.fromHeight(44),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: blue,
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 10),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
        minimumSize: const Size(44, 44),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        side: BorderSide(color: line),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        minimumSize: const Size.fromHeight(48),
      ),
    ),
  );
}

class _AccountHeroBackground extends StatelessWidget {
  const _AccountHeroBackground();

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const Alignment(-0.8, -1.0),
            radius: 1.0,
            colors: [
              const Color(0xffeddae9).withValues(alpha: 0.47),
              const Color(0x00eddae9),
            ],
            stops: const [0, 0.6],
          ),
        ),
      ),
      DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const Alignment(1.0, 0.6),
            radius: 1.0,
            colors: [
              const Color(0xffd7e4f6).withValues(alpha: 0.33),
              const Color(0x00d7e4f6),
            ],
            stops: const [0, 0.7],
          ),
        ),
      ),
    ],
  );
}
