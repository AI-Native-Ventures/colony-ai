import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Context supplied whenever the shell builds a primary destination.
@immutable
class MobileShellRouteContext {
  const MobileShellRouteContext({
    required this.tabReselection,
    required this.settingsPageBuilder,
    required this.onSettingsTransitionProgress,
  });

  final ValueListenable<int> tabReselection;
  final WidgetBuilder settingsPageBuilder;
  final ValueChanged<double> onSettingsTransitionProgress;
}
