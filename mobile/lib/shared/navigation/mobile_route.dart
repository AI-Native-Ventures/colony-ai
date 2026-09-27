import 'package:flutter/material.dart';

typedef MobileRouteBuilder<TArguments> =
    Widget Function(BuildContext context, TArguments arguments);

/// A typed route key shared by app composition and isolated feature modules.
@immutable
class MobileRoute<TArguments> {
  const MobileRoute(this.path);

  final String path;
}

/// Typed route arguments for screens that do not need a payload.
@immutable
class NoMobileRouteArguments {
  const NoMobileRouteArguments();
}

abstract interface class _MobileRouteEntry {
  Type get argumentsType;

  Widget build(BuildContext context, Object? arguments);
}

class _TypedMobileRouteEntry<TArguments> implements _MobileRouteEntry {
  const _TypedMobileRouteEntry(this.builder);

  final MobileRouteBuilder<TArguments> builder;

  @override
  Type get argumentsType => TArguments;

  @override
  Widget build(BuildContext context, Object? arguments) =>
      builder(context, arguments as TArguments);
}

/// Immutable registry for pages composed at the app boundary.
class MobileRouteRegistry {
  const MobileRouteRegistry._(this._entries);

  factory MobileRouteRegistry.empty() => const MobileRouteRegistry._({});

  final Map<String, _MobileRouteEntry> _entries;

  bool contains<TArguments>(MobileRoute<TArguments> route) =>
      _entries.containsKey(route.path);

  MobileRouteRegistry register<TArguments>(
    MobileRoute<TArguments> route,
    MobileRouteBuilder<TArguments> builder,
  ) {
    if (_entries.containsKey(route.path)) {
      throw ArgumentError.value(route.path, 'route.path', 'Already registered');
    }
    return MobileRouteRegistry._(
      Map<String, _MobileRouteEntry>.unmodifiable({
        ..._entries,
        route.path: _TypedMobileRouteEntry<TArguments>(builder),
      }),
    );
  }

  Widget? maybeBuild<TArguments>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) {
    final entry = _entries[route.path];
    if (entry == null) return null;
    if (entry.argumentsType != TArguments) {
      throw StateError(
        'Route ${route.path} expects ${entry.argumentsType}, '
        'received $TArguments',
      );
    }
    return entry.build(context, arguments);
  }

  Widget build<TArguments>(
    BuildContext context,
    MobileRoute<TArguments> route,
    TArguments arguments,
  ) =>
      maybeBuild(context, route, arguments) ??
      (throw StateError('No mobile route registered for ${route.path}'));
}
