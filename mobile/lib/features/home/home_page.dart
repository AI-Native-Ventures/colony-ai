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
    final chatReselection = useValueNotifier(0);
    final companyReselection = useValueNotifier(0);
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
    final chatPage = _buildPage(
      context,
      MobileRoutes.chats,
      routeContext(chatReselection),
    );
    final companyPage = _buildPage(
      context,
      MobileRoutes.business,
      routeContext(companyReselection),
    );

    Widget pageFor(MobileShellDestination destination, Widget page) {
      if (!visited.value.contains(destination)) {
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
        showBrandBar: false,
        overlayBuilder: overlayBuilder,
        onDestinationSelected: (next) {
          if (next == selected.value) {
            switch (next) {
              case MobileShellDestination.today:
                todayReselection.value++;
              case MobileShellDestination.chat:
                chatReselection.value++;
              case MobileShellDestination.company:
                companyReselection.value++;
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
                  pageFor(MobileShellDestination.chat, chatPage),
                  pageFor(MobileShellDestination.company, companyPage),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPage<TArguments>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) => routeRegistry.build(context, route, arguments);
}
