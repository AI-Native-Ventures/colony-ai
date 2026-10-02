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
    this.footerTopPadding = 12,
    this.footerBottomPadding = 8,
    this.footerHorizontalMargin = 0,
    this.showBackButton = true,
    this.showBrandBar = true,
    this.centerBrandTitle = false,
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
  final double footerTopPadding;
  final double footerBottomPadding;
  final double footerHorizontalMargin;
  final bool showBackButton;
  final bool showBrandBar;
  final bool centerBrandTitle;
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
                    centerTitle: centerBrandTitle,
                    titleSpacing: showBackButton ? 8 : Grid.gutter,
                    leadingWidth: showBackButton ? 68 : 0,
                    leading: showBackButton
                        ? Padding(
                            padding: const EdgeInsets.only(left: 20),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: SizedBox(
                                width: 42,
                                height: 42,
                                child: Semantics(
                                  button: true,
                                  label: 'Back',
                                  onTap:
                                      onBack ??
                                      () => Navigator.of(context).maybePop(),
                                  child: ExcludeSemantics(
                                    child: Material(
                                      color: paper,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(14),
                                        side: BorderSide(color: line),
                                      ),
                                      child: InkWell(
                                        borderRadius: BorderRadius.circular(14),
                                        onTap:
                                            onBack ??
                                            () => Navigator.of(
                                              context,
                                            ).maybePop(),
                                        child: Center(
                                          child: Icon(
                                            Icons.arrow_back_ios_new,
                                            size: 18,
                                            color: AccountFlowPalette.ink(
                                              brightness,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
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
                            showHeroBackground ? 16 : 8,
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
                      margin: EdgeInsets.symmetric(
                        horizontal: footerHorizontalMargin,
                      ),
                      padding: EdgeInsets.fromLTRB(
                        20,
                        footerTopPadding,
                        20,
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
  final accent = AccountFlowPalette.accent(brightness);
  final onAccent = AccountFlowPalette.onAccent(brightness);
  final error = AccountFlowPalette.error(brightness);
  final errorContainer = AccountFlowPalette.errorContainer(brightness);
  final onErrorContainer = AccountFlowPalette.onErrorContainer(brightness);
  final colorScheme = base.colorScheme.copyWith(
    primary: accent,
    onPrimary: onAccent,
    secondary: accent,
    onSecondary: onAccent,
    error: error,
    onError: Colors.white,
    surface: paper,
    onSurface: ink,
    surfaceContainerLowest: AccountFlowPalette.field(brightness),
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
        backgroundColor: accent,
        foregroundColor: onAccent,
        disabledBackgroundColor: accent.withValues(alpha: 0.45),
        disabledForegroundColor: onAccent.withValues(alpha: 0.45),
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
        foregroundColor: accent,
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
              const Color(0xffe8d7ee).withValues(alpha: 0.48),
              const Color(0x00e8d7ee),
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
              const Color(0xfff2dccc).withValues(alpha: 0.34),
              const Color(0x00f2dccc),
            ],
            stops: const [0, 0.7],
          ),
        ),
      ),
    ],
  );
}
