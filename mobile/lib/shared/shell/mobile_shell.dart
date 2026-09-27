import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';

/// The three primary destinations in the approved mobile v5 shell.
enum MobileShellDestination { today, chat, company }

/// Geometry supplied to app-composed shell overlays.
@immutable
class MobileShellOverlayContext {
  const MobileShellOverlayContext({
    required this.destination,
    required this.navigationBarHeight,
    required this.navigationBarWidth,
    required this.bottomInset,
  });

  final MobileShellDestination destination;
  final double navigationBarHeight;
  final double navigationBarWidth;
  final double bottomInset;
}

typedef MobileShellOverlayBuilder =
    Widget Function(
      BuildContext context,
      MobileShellOverlayContext shellContext,
    );

/// Shared brand bar and fixed three-destination phone navigation.
class MobileShell extends StatelessWidget {
  const MobileShell({
    required this.destination,
    required this.onDestinationSelected,
    required this.child,
    this.showBrandBar = true,
    this.hasUnreadActivity = false,
    this.overlayBuilder,
    super.key,
  });

  static const double brandBarHeight = MobileLayoutTokens.brandBarHeight;
  static const double navigationBarHeight =
      MobileLayoutTokens.bottomNavigationHeight;

  final MobileShellDestination destination;
  final ValueChanged<MobileShellDestination> onDestinationSelected;
  final Widget child;
  final bool showBrandBar;
  final bool hasUnreadActivity;
  final MobileShellOverlayBuilder? overlayBuilder;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final width = MediaQuery.sizeOf(context).width;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final overlay = overlayBuilder?.call(
      context,
      MobileShellOverlayContext(
        destination: destination,
        navigationBarHeight: navigationBarHeight,
        navigationBarWidth: width,
        bottomInset: bottomInset,
      ),
    );

    return Stack(
      fit: StackFit.expand,
      children: [
        Scaffold(
          resizeToAvoidBottomInset: false,
          backgroundColor: tokens.canvas,
          body: Column(
            children: [
              if (showBrandBar)
                Container(
                  key: const ValueKey('mobile-brand-bar'),
                  height: brandBarHeight,
                  padding: const EdgeInsets.symmetric(
                    horizontal: Grid.fourteen,
                  ),
                  alignment: Alignment.centerLeft,
                  decoration: BoxDecoration(
                    color: tokens.canvas,
                    border: Border(
                      bottom: BorderSide(color: tokens.brandBarDivider),
                    ),
                  ),
                  child: Text(
                    'colony',
                    style: context.mobileTypography.brandWordmark.copyWith(
                      color: tokens.ink,
                    ),
                  ),
                ),
              Expanded(child: child),
            ],
          ),
          bottomNavigationBar: _MobileBottomNavigation(
            destination: destination,
            hasUnreadActivity: hasUnreadActivity,
            onDestinationSelected: onDestinationSelected,
            bottomInset: bottomInset,
          ),
        ),
        if (overlay != null) Positioned.fill(child: overlay),
      ],
    );
  }
}

class _MobileBottomNavigation extends StatelessWidget {
  const _MobileBottomNavigation({
    required this.destination,
    required this.hasUnreadActivity,
    required this.onDestinationSelected,
    required this.bottomInset,
  });

  final MobileShellDestination destination;
  final bool hasUnreadActivity;
  final ValueChanged<MobileShellDestination> onDestinationSelected;
  final double bottomInset;

  static const _destinations = [
    (
      key: MobileShellDestination.today,
      label: 'Today',
      icon: LucideIcons.house,
    ),
    (
      key: MobileShellDestination.chat,
      label: 'Chat',
      icon: LucideIcons.messageSquare,
    ),
    (
      key: MobileShellDestination.company,
      label: 'Company',
      icon: LucideIcons.building2,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: MobileShell.navigationBarHeight + bottomInset,
      key: const ValueKey('mobile-bottom-navigation'),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(top: BorderSide(color: tokens.line)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(Grid.twelve, 0, Grid.twelve, bottomInset),
        child: Row(
          children: [
            for (final item in _destinations)
              Expanded(
                child: _MobileNavigationItem(
                  destination: item.key,
                  label: item.label,
                  icon: item.icon,
                  selected: destination == item.key,
                  showUnread:
                      item.key == MobileShellDestination.today &&
                      hasUnreadActivity,
                  onTap: () => onDestinationSelected(item.key),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MobileNavigationItem extends StatelessWidget {
  const _MobileNavigationItem({
    required this.destination,
    required this.label,
    required this.icon,
    required this.selected,
    required this.showUnread,
    required this.onTap,
  });

  final MobileShellDestination destination;
  final String label;
  final IconData icon;
  final bool selected;
  final bool showUnread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final color = selected ? tokens.action : tokens.muted;
    final semanticLabel = showUnread ? '$label, unread' : label;

    return Semantics(
      key: ValueKey('mobile-nav-${destination.name}'),
      button: true,
      selected: selected,
      label: semanticLabel,
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          overlayColor: WidgetStatePropertyAll(
            tokens.action.withValues(alpha: 0.08),
          ),
          child: Center(
            child: AnimatedContainer(
              width: 72,
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : MotionTokens.tabSelection,
              curve: Curves.easeOutCubic,
              padding: const EdgeInsets.symmetric(vertical: 6),
              decoration: BoxDecoration(
                color: selected
                    ? tokens.actionSoft
                    : tokens.paper.withValues(alpha: 0),
                borderRadius: BorderRadius.circular(Radii.companyPinned),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Stack(
                    alignment: Alignment.center,
                    clipBehavior: Clip.none,
                    children: [
                      Icon(icon, size: 21, color: color),
                      if (showUnread && !selected)
                        Positioned(
                          top: -2,
                          right: -4,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: tokens.action,
                              border: Border.all(color: tokens.paper, width: 1),
                              shape: BoxShape.circle,
                            ),
                            child: const SizedBox(width: 6, height: 6),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: Grid.half),
                  Text(
                    label,
                    style: context.mobileTypography.navigationLabel.copyWith(
                      color: color,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                    ),
                    softWrap: false,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
