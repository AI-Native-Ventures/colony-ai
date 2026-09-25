import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/theme.dart';

/// The four primary destinations in the r16 mobile shell.
enum MobileShellDestination { today, chats, activity, business }

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

/// Shared brand bar and fixed four-destination phone navigation.
class MobileShell extends StatelessWidget {
  const MobileShell({
    required this.destination,
    required this.onDestinationSelected,
    required this.child,
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
              Container(
                key: const ValueKey('mobile-brand-bar'),
                height: brandBarHeight,
                padding: const EdgeInsets.symmetric(horizontal: Grid.fourteen),
                alignment: Alignment.centerLeft,
                decoration: BoxDecoration(
                  color: tokens.canvas,
                  border: Border(
                    bottom: BorderSide(color: tokens.brandBarDivider),
                  ),
                ),
                child: Text(
                  'colony',
                  style: context.textTheme.titleLarge?.copyWith(
                    color: tokens.ink,
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -1.4,
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
  });

  final MobileShellDestination destination;
  final bool hasUnreadActivity;
  final ValueChanged<MobileShellDestination> onDestinationSelected;

  static const _destinations = [
    (
      key: MobileShellDestination.today,
      label: 'Today',
      iconPath: 'm3 10 9-7 9 7v11h-7v-7h-4v7H3z',
    ),
    (
      key: MobileShellDestination.chats,
      label: 'Chats',
      iconPath: 'M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z',
    ),
    (
      key: MobileShellDestination.activity,
      label: 'Activity',
      iconPath: 'm3 12 4 0 3-8 4 16 3-8h4',
    ),
    (
      key: MobileShellDestination.business,
      label: 'Business',
      iconPath: 'M3 7h18v14H3zM8 7V3h8v4M3 12h18',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: MobileShell.navigationBarHeight,
      key: const ValueKey('mobile-bottom-navigation'),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(top: BorderSide(color: tokens.line)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Grid.twelve),
        child: Row(
          children: [
            for (final item in _destinations)
              Expanded(
                child: _MobileNavigationItem(
                  destination: item.key,
                  label: item.label,
                  iconPath: item.iconPath,
                  selected: destination == item.key,
                  showUnread:
                      item.key == MobileShellDestination.activity &&
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
    required this.iconPath,
    required this.selected,
    required this.showUnread,
    required this.onTap,
  });

  final MobileShellDestination destination;
  final String label;
  final String iconPath;
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
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 32,
                  height: 32,
                  child: Stack(
                    alignment: Alignment.center,
                    clipBehavior: Clip.none,
                    children: [
                      if (selected)
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: tokens.actionSoft,
                            borderRadius: BorderRadius.circular(Radii.md),
                            boxShadow: [
                              BoxShadow(
                                color: tokens.actionSoft,
                                spreadRadius: 5,
                              ),
                            ],
                          ),
                          child: const SizedBox(width: 21, height: 21),
                        ),
                      SvgPicture.string(
                        '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="$iconPath"/></svg>',
                        width: 21,
                        height: 21,
                        colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
                        excludeFromSemantics: true,
                      ),
                      if (showUnread && !selected)
                        Positioned(
                          top: 3,
                          right: 3,
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
                ),
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
    );
  }
}
