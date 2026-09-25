import 'package:flutter/material.dart';

import 'mobile_route.dart';

/// Provides app-composed routes to independent feature modules.
class MobileRouteScope extends InheritedWidget {
  const MobileRouteScope({
    required this.registry,
    required super.child,
    super.key,
  });

  final MobileRouteRegistry registry;

  static MobileRouteScope of(BuildContext context) {
    final scope = context
        .dependOnInheritedWidgetOfExactType<MobileRouteScope>();
    if (scope == null) {
      throw StateError('MobileRouteScope is not mounted above this context');
    }
    return scope;
  }

  static Future<TResult?> push<TArguments, TResult>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) {
    final registry = of(context).registry;
    return Navigator.of(context).push<TResult>(
      MaterialPageRoute<TResult>(
        builder: (routeContext) => MobileRouteScope(
          registry: registry,
          child: registry.build(routeContext, route, arguments),
        ),
      ),
    );
  }

  @override
  bool updateShouldNotify(MobileRouteScope oldWidget) =>
      !identical(registry, oldWidget.registry);
}
