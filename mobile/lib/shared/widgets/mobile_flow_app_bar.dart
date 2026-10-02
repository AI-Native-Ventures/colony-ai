import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';

/// App bar geometry and back affordance used by the frozen mobile flows.
class MobileFlowAppBar extends StatelessWidget implements PreferredSizeWidget {
  const MobileFlowAppBar({
    required this.title,
    this.subtitle,
    this.backLabel = 'Back',
    this.onBack,
    this.compact = false,
    super.key,
  });

  final String title;
  final String? subtitle;
  final String backLabel;
  final VoidCallback? onBack;
  final bool compact;

  double get _height => compact
      ? MobileLayoutTokens.compactAppBarHeight
      : MobileLayoutTokens.appBarHeight;

  @override
  Size get preferredSize => Size.fromHeight(_height);

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return AppBar(
      backgroundColor: tokens.canvas,
      foregroundColor: tokens.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: _height - 1,
      titleSpacing: 16,
      title: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: context.textTheme.titleSmall?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (subtitle?.trim().isNotEmpty == true)
            Text(
              subtitle!.trim(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.muted,
              ),
            ),
        ],
      ),
      leadingWidth: 60,
      leading: Padding(
        padding: const EdgeInsets.only(left: 16),
        child: Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: 44,
            height: 44,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: tokens.paper,
                border: Border.all(color: tokens.line),
                borderRadius: BorderRadius.circular(14),
              ),
              child: IconButton(
                tooltip: backLabel,
                onPressed: onBack ?? () => Navigator.of(context).maybePop(),
                icon: const Icon(LucideIcons.chevronLeft),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Applies the approved mobile action color while keeping shared button sizing.
ButtonStyle mobileFlowActionButtonStyle(BuildContext context) =>
    FilledButton.styleFrom(
      backgroundColor: context.mobileTokens.flowAction,
      foregroundColor: context.mobileTokens.flowActionForeground,
    );
