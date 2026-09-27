import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';

/// App bar geometry and back affordance used by the frozen mobile flows.
class MobileFlowAppBar extends StatelessWidget implements PreferredSizeWidget {
  const MobileFlowAppBar({
    required this.title,
    this.backLabel = 'Back',
    this.onBack,
    super.key,
  });

  final String title;
  final String backLabel;
  final VoidCallback? onBack;

  @override
  Size get preferredSize =>
      const Size.fromHeight(MobileLayoutTokens.appBarHeight);

  @override
  Widget build(BuildContext context) => AppBar(
    toolbarHeight: MobileLayoutTokens.appBarHeight - 1,
    title: Text(
      title,
      style: context.textTheme.titleSmall?.copyWith(
        color: context.colors.onSurface,
        fontWeight: FontWeight.w600,
      ),
    ),
    leading: IconButton(
      tooltip: backLabel,
      onPressed: onBack ?? () => Navigator.of(context).maybePop(),
      icon: const Icon(LucideIcons.chevronLeft),
    ),
    bottom: PreferredSize(
      preferredSize: const Size.fromHeight(1),
      child: Divider(height: 1, color: context.mobileTokens.line),
    ),
  );
}

/// Applies the frozen flow action color while keeping the shared button sizing.
ButtonStyle mobileFlowActionButtonStyle(BuildContext context) =>
    FilledButton.styleFrom(
      backgroundColor: context.mobileTokens.action,
      foregroundColor: context.colors.onPrimary,
    );
