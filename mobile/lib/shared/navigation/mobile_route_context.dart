import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Context supplied whenever the shell builds a primary destination.
@immutable
class MobileShellRouteContext {
  const MobileShellRouteContext({
    required this.tabReselection,
    required this.settingsPageBuilder,
    required this.onSettingsTransitionProgress,
    this.onOpenChat,
    this.onOpenTeamUpdates,
  });

  final ValueListenable<int> tabReselection;
  final WidgetBuilder settingsPageBuilder;
  final ValueChanged<double> onSettingsTransitionProgress;

  /// Selects the shell's Chat destination without pushing a second route.
  final VoidCallback? onOpenChat;

  /// Selects Chat and opens its Team updates route.
  final VoidCallback? onOpenTeamUpdates;
}
