import 'mobile_route.dart';
import 'mobile_route_context.dart';

/// Canonical route keys for shared mobile entry points.
abstract final class MobileRoutes {
  static const today = MobileRoute<MobileShellRouteContext>('today');
  static const chats = MobileRoute<MobileShellRouteContext>('channels');
  static const activity = MobileRoute<MobileShellRouteContext>('activity');
  static const business = MobileRoute<MobileShellRouteContext>('business');
  static const updates = MobileRoute<NoMobileRouteArguments>('updates/feed');
  static const search = MobileRoute<NoMobileRouteArguments>(
    'navigation/search',
  );
  static const accountAge = MobileRoute<NoMobileRouteArguments>('account/age');
}
