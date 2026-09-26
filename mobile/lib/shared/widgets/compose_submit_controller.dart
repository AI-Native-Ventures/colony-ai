import 'package:flutter/widgets.dart';

/// Lets a screen trigger the send action owned by its embedded composer.
class ComposeSubmitController {
  VoidCallback? _submit;
  VoidCallback? _removeDraft;

  /// Runs the currently bound submit action, if its composer is mounted.
  void submit() => _submit?.call();

  /// Removes the local text draft owned by the bound composer.
  void removeDraft() => _removeDraft?.call();

  /// Updates the action supplied by the current composer build.
  void bind(VoidCallback submit, {VoidCallback? removeDraft}) {
    _submit = submit;
    _removeDraft = removeDraft;
  }
}
