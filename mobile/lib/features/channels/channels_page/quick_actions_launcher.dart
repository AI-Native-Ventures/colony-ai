part of '../channels_page.dart';

const _kQuickActionsTabMotionDuration = Duration(milliseconds: 220);
const _kQuickActionsTabMotionCurve = Cubic(0.77, 0, 0.175, 1);
const _kQuickActionsHiddenOverlap = Grid.half;
const _kQuickActionsHiddenScale = 0.8;

/// Shows the existing quick-action menu when opened from the pinned header.
///
/// The expanded menu stays aligned with mobile navigation and closes when the
/// user leaves Chats.
class ChannelQuickActionsLauncher extends HookConsumerWidget {
  /// Whether the launcher should be visible beside the navigation bar.
  final bool visible;

  /// Height of the navigation bar used to vertically center the closed button.
  final double navigationBarHeight;

  /// Space between the navigation bar and the bottom safe area.
  final double navigationBarBottomGap;

  /// Full width of the navigation bar, including its inner edge padding.
  final double navigationBarWidth;

  /// Bottom system inset used by the navigation bar's [SafeArea].
  final double systemBottomInset;

  /// App-composed routes needed by a newly opened forum channel.
  final MobileRouteRegistry? routeRegistry;

  /// Distance between the launcher and the right edge of the screen.
  final double rightInset;

  /// Creates a launcher aligned with the supplied navigation geometry.
  const ChannelQuickActionsLauncher({
    super.key,
    required this.visible,
    required this.navigationBarHeight,
    required this.navigationBarBottomGap,
    required this.navigationBarWidth,
    required this.systemBottomInset,
    required this.rightInset,
    this.routeRegistry,
  });

  /// Opens the existing quick actions from another app-composed surface.
  static void openFromHome(WidgetRef ref) {
    ref.read(_channelQuickActionsOpenProvider.notifier).open();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentPubkey = ref.watch(currentPubkeyProvider);
    final quickActionsOpen = ref.watch(_channelQuickActionsOpenProvider);
    final reducedMotion = MediaQuery.of(context).disableAnimations;
    final navigationBottomInset = systemBottomInset > navigationBarBottomGap
        ? systemBottomInset
        : navigationBarBottomGap;
    final closedBottomInset =
        navigationBottomInset + ((navigationBarHeight - _kMorphClosedSize) / 2);
    final openLift =
        navigationBarHeight +
        Grid.xxs -
        ((navigationBarHeight - _kMorphClosedSize) / 2);
    final effectiveOpen = visible && quickActionsOpen;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final navigationBarRight = (screenWidth + navigationBarWidth) / 2;
    final launcherRight = screenWidth - rightInset;
    final hiddenHorizontalOffset =
        navigationBarRight - launcherRight - _kQuickActionsHiddenOverlap;

    useEffect(() {
      if (!visible && quickActionsOpen) {
        ref.read(_channelQuickActionsOpenProvider.notifier).close();
      }
      return null;
    }, [visible]);

    Future<void> openChannel(Channel channel) async {
      if (!context.mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              ChannelDetailPage(channel: channel, routeRegistry: routeRegistry),
        ),
      );
    }

    Future<void> selectQuickAction(_QuickAction action) async {
      ref.read(_channelQuickActionsOpenProvider.notifier).close();
      if (!reducedMotion) {
        await Future<void>.delayed(_kMorphCloseDuration);
      }
      if (!context.mounted) return;

      switch (action) {
        case _QuickAction.createChannel:
          final created = await showBuzzModalBottomSheet<Channel>(
            context: context,
            title: 'Create a new channel',
            constraints: _quickActionSheetConstraints(context),
            isScrollControlled: true,
            showDragHandle: true,
            builder: (_) => const _CreateChannelSheet(channelType: 'stream'),
          );
          if (created != null && context.mounted) {
            await openChannel(created);
          }
        case _QuickAction.newDm:
          final opened = await showBuzzModalBottomSheet<Channel>(
            context: context,
            title: 'New message',
            constraints: _quickActionSheetConstraints(context),
            isScrollControlled: true,
            showDragHandle: true,
            builder: (_) =>
                _NewDirectMessageSheet(currentPubkey: currentPubkey),
          );
          if (opened != null && context.mounted) {
            await openChannel(opened);
          }
        case _QuickAction.browseChannels:
          await showBuzzModalBottomSheet<void>(
            context: context,
            title: 'Browse channels',
            constraints: _quickActionSheetConstraints(context),
            isScrollControlled: true,
            showDragHandle: true,
            builder: (_) => const _BrowseChannelsSheet(),
          );
      }
    }

    return Stack(
      fit: StackFit.expand,
      clipBehavior: Clip.none,
      children: [
        if (quickActionsOpen)
          Positioned.fill(
            child: Semantics(
              button: true,
              label: 'Close quick actions',
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () =>
                    ref.read(_channelQuickActionsOpenProvider.notifier).close(),
              ),
            ),
          ),
        AnimatedPositioned(
          duration: reducedMotion
              ? Duration.zero
              : _kQuickActionsTabMotionDuration,
          curve: _kQuickActionsTabMotionCurve,
          right: rightInset,
          bottom: closedBottomInset + (effectiveOpen ? openLift : 0),
          child: IgnorePointer(
            ignoring: !visible || !quickActionsOpen,
            child: ExcludeSemantics(
              excluding: !visible,
              child: TweenAnimationBuilder<double>(
                key: const Key('channel-quick-actions-motion'),
                tween: Tween(end: visible ? 0 : 1),
                duration: reducedMotion
                    ? Duration.zero
                    : _kQuickActionsTabMotionDuration,
                curve: _kQuickActionsTabMotionCurve,
                builder: (context, hiddenProgress, child) => Opacity(
                  key: const Key('channel-quick-actions-opacity'),
                  opacity: 1 - hiddenProgress,
                  child: Transform.translate(
                    key: const Key('channel-quick-actions-transform'),
                    offset: Offset(hiddenHorizontalOffset * hiddenProgress, 0),
                    child: Transform.scale(
                      key: const Key('channel-quick-actions-scale'),
                      scale:
                          1 -
                          ((1 - _kQuickActionsHiddenScale) * hiddenProgress),
                      child: child,
                    ),
                  ),
                ),
                child: _MorphingQuickActionsButton(
                  open: effectiveOpen,
                  showClosedButton: false,
                  openEdgeOffset: rightInset - Grid.gutter,
                  onToggle: () {},
                  onSelected: (action) => unawaited(selectQuickAction(action)),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

BoxConstraints _quickActionSheetConstraints(BuildContext context) {
  final mediaQuery = MediaQuery.of(context);
  return BoxConstraints(
    maxHeight: mediaQuery.size.height - mediaQuery.viewPadding.top - Grid.sm,
  );
}
