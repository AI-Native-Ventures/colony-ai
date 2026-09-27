import 'package:flutter/material.dart';

import 'mobile_route.dart';
import 'mobile_route_context.dart';
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

  /// Opens Activity above the Today tab's retained navigation stack.
  static Future<void> openActivity(
    BuildContext context,
    MobileShellRouteContext routeContext,
  ) async {
    await push<MobileShellRouteContext, void>(
      context,
      MobileRoutes.activity,
      routeContext,
    );
  }

  static Future<void> openUpdateNote(BuildContext context, String noteId) =>
      push<String, void>(context, MobileRoutes.updateNote, noteId);

  static Future<bool?> openUpdateCompose(BuildContext context) =>
      push<NoMobileRouteArguments, bool>(
        context,
        MobileRoutes.updateCompose,
        const NoMobileRouteArguments(),
      );

  static Future<void> openUpdateDraft(BuildContext context) =>
      push<NoMobileRouteArguments, void>(
        context,
        MobileRoutes.updateDraft,
        const NoMobileRouteArguments(),
      );

  static Future<void> openUpdateFailed(BuildContext context) =>
      push<NoMobileRouteArguments, void>(
        context,
        MobileRoutes.updateFailed,
        const NoMobileRouteArguments(),
      );

  static Future<void> openUpdatePublished(BuildContext context) =>
      push<NoMobileRouteArguments, void>(
        context,
        MobileRoutes.updatePublished,
        const NoMobileRouteArguments(),
      );
}
