import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_route_context.dart';
import '../../shared/navigation/mobile_route_scope.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/shell/mobile_shell.dart';

/// App-level composition point for the mobile shell's primary destinations.
class HomePage extends HookConsumerWidget {
  const HomePage({
    required this.routeRegistry,
    required this.settingsPageBuilder,
    required this.hasUnreadInbox,
    this.accountClaimPrompt,
    this.overlayBuilder,
    super.key,
  });

  final MobileRouteRegistry routeRegistry;
  final WidgetBuilder settingsPageBuilder;
  final bool hasUnreadInbox;
  final Widget? accountClaimPrompt;
  final MobileShellOverlayBuilder? overlayBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = useState(MobileShellDestination.today);
    final visited = useState(<MobileShellDestination>{
      MobileShellDestination.today,
    });
    final todayReselection = useValueNotifier(0);
    final chatsReselection = useValueNotifier(0);
    final activityReselection = useValueNotifier(0);
    final businessReselection = useValueNotifier(0);
    final tabNavigatorKeys = useMemoized(
      () => List.generate(
        MobileShellDestination.values.length,
        (_) => GlobalKey<NavigatorState>(),
      ),
    );

    MobileShellRouteContext routeContext(ValueListenable<int> tabReselection) =>
        MobileShellRouteContext(
          tabReselection: tabReselection,
          settingsPageBuilder: settingsPageBuilder,
          onSettingsTransitionProgress: (_) {},
        );

    final todayPage = _buildPage(
      context,
      MobileRoutes.today,
      routeContext(todayReselection),
    );
    final chatsPage = _buildPage(
      context,
      MobileRoutes.chats,
      routeContext(chatsReselection),
    );
    final activityPage = _buildPage(
      context,
      MobileRoutes.activity,
      routeContext(activityReselection),
    );
    final businessPage = _buildPage(
      context,
      MobileRoutes.business,
      routeContext(businessReselection),
    );

    Widget pageFor(MobileShellDestination destination, Widget? page) {
      if (!visited.value.contains(destination) || page == null) {
        return const SizedBox.shrink();
      }

      final navigatorKey =
          tabNavigatorKeys[MobileShellDestination.values.indexOf(destination)];
      return NavigatorPopHandler<void>(
        enabled: selected.value == destination,
        onPopWithResult: (_) {
          navigatorKey.currentState?.maybePop();
        },
        child: Navigator(
          key: navigatorKey,
          onGenerateRoute: (settings) =>
              MaterialPageRoute<void>(settings: settings, builder: (_) => page),
        ),
      );
    }

    return MobileRouteScope(
      registry: routeRegistry,
      child: MobileShell(
        destination: selected.value,
        hasUnreadActivity: hasUnreadInbox,
        showBrandBar: selected.value != MobileShellDestination.chats,
        overlayBuilder: overlayBuilder,
        onDestinationSelected: (next) {
          if (next == selected.value) {
            switch (next) {
              case MobileShellDestination.today:
                todayReselection.value++;
              case MobileShellDestination.chats:
                chatsReselection.value++;
              case MobileShellDestination.activity:
                activityReselection.value++;
              case MobileShellDestination.business:
                businessReselection.value++;
            }
            return;
          }

          unawaited(HapticFeedback.selectionClick());
          visited.value = {...visited.value, next};
          selected.value = next;
        },
        child: Column(
          children: [
            ?accountClaimPrompt,
            Expanded(
              child: IndexedStack(
                index: MobileShellDestination.values.indexOf(selected.value),
                children: [
                  pageFor(MobileShellDestination.today, todayPage),
                  pageFor(MobileShellDestination.chats, chatsPage),
                  pageFor(MobileShellDestination.activity, activityPage),
                  pageFor(MobileShellDestination.business, businessPage),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget? _buildPage<TArguments>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) => routeRegistry.maybeBuild(context, route, arguments);
}
