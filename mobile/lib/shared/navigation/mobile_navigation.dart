import 'package:flutter/material.dart';

import 'mobile_route.dart';
import 'mobile_route_scope.dart';
import 'mobile_routes.dart';

/// Typed navigation access for feature modules composed by the app root.
abstract final class MobileNavigation {
  static Future<TResult?> push<TArguments, TResult>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) => MobileRouteScope.push<TArguments, TResult>(context, route, arguments);

  static Future<void> openSearch(BuildContext context) =>
      push<NoMobileRouteArguments, void>(
        context,
        MobileRoutes.search,
        const NoMobileRouteArguments(),
      );

  static Future<void> openUpdates(BuildContext context) =>
      push<NoMobileRouteArguments, void>(
        context,
        MobileRoutes.updates,
        const NoMobileRouteArguments(),
      );
}
