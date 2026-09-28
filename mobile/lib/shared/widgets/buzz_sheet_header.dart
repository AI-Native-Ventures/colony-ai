import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';
import 'buzz_navigation_metrics.dart';
import 'ios_glass_navigation_button.dart';

/// A titled sheet header with balanced actions and an exactly centered title.
class BuzzSheetHeader extends StatelessWidget {
  const BuzzSheetHeader({
    super.key,
    this.title,
    this.titleKey,
    this.leading,
    this.trailing,
    this.showDragHandle = false,
    this.centerTitle = true,
  });

  final String? title;
  final Key? titleKey;
  final Widget? leading;
  final Widget? trailing;
  final bool showDragHandle;
  final bool centerTitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        top: Grid.xxs,
        left: centerTitle ? Grid.gutter : Grid.scrollInset,
        right: centerTitle ? Grid.gutter : Grid.scrollInset,
        bottom: centerTitle ? Grid.xs : 0,
      ),
      child: SizedBox(
        height: centerTitle
            ? buzzNavigationRowHeight
            : buzzNavigationRowHeight + Grid.xs + Grid.half,
        child: Stack(
          alignment: Alignment.topCenter,
          children: [
            if (showDragHandle) const _SheetDragHandle(),
            if (title case final title?)
              Positioned(
                left: centerTitle ? 64 : 0,
                right: 64,
                bottom: 0,
                height: 44,
                child: Align(
                  alignment: centerTitle
                      ? Alignment.center
                      : Alignment.centerLeft,
                  child: Text(
                    title,
                    key: titleKey ?? const ValueKey('buzz-sheet-title'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: centerTitle ? TextAlign.center : TextAlign.start,
                    style:
                        (centerTitle
                                ? context.textTheme.titleSmall
                                : context.mobileTypography.sheetHeaderTitle)
                            ?.copyWith(
                              color: centerTitle
                                  ? null
                                  : context.mobileTokens.ink,
                              fontWeight: centerTitle
                                  ? FontWeight.w600
                                  : FontWeight.w700,
                            ),
                  ),
                ),
              ),
            Align(
              alignment: Alignment.bottomRight,
              child: trailing ?? _SheetCloseButton(centerTitle: centerTitle),
            ),
            if (leading case final leading?)
              Align(alignment: Alignment.bottomLeft, child: leading),
          ],
        ),
      ),
    );
  }
}

class _SheetCloseButton extends StatelessWidget {
  const _SheetCloseButton({required this.centerTitle});

  final bool centerTitle;

  @override
  Widget build(BuildContext context) {
    void closeSheet() {
      unawaited(HapticFeedback.lightImpact());
      Navigator.of(context).pop();
    }

    if (Theme.of(context).platform == TargetPlatform.iOS) {
      return IosGlassNavigationButton(
        key: const ValueKey('buzz-sheet-ios-glass-close'),
        icon: IosGlassNavigationIcon.close,
        semanticLabel: 'Close sheet',
        onPressed: closeSheet,
        width: buzzNavigationActionSize,
        height: buzzNavigationActionSize,
        foregroundColor: centerTitle
            ? context.colors.primary
            : context.mobileTokens.ink,
      );
    }

    return SizedBox.square(
      dimension: buzzNavigationActionSize,
      child: IconButton(
        tooltip: 'Close sheet',
        onPressed: closeSheet,
        style: IconButton.styleFrom(
          padding: EdgeInsets.zero,
          backgroundColor: context.colors.surfaceContainerHighest,
          foregroundColor: centerTitle
              ? context.colors.primary
              : context.mobileTokens.ink,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.dialog),
          ),
        ),
        icon: const Icon(LucideIcons.x, size: 22),
      ),
    );
  }
}

class _SheetDragHandle extends StatelessWidget {
  const _SheetDragHandle();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      container: true,
      button: true,
      onTap: () => Navigator.of(context).pop(),
      child: Container(
        key: const ValueKey('buzz-sheet-drag-handle'),
        width: 32,
        height: 4,
        decoration: BoxDecoration(
          color: context.colors.onSurfaceVariant.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(Radii.full),
        ),
      ),
    );
  }
}
