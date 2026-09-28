import 'package:flutter/material.dart';

import 'account_flow_palette.dart';

/// Full-width account action using the app's existing primary button style.
class AccountActionButton extends StatelessWidget {
  const AccountActionButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.disabledHint,
    this.solidWhenDisabled = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final String? disabledHint;
  final bool solidWhenDisabled;

  @override
  Widget build(BuildContext context) {
    final enabled = !isLoading && onPressed != null;
    final brightness = Theme.of(context).brightness;
    final action = AccountFlowPalette.accent(brightness);
    final onAction = AccountFlowPalette.onAccent(brightness);
    return Semantics(
      button: true,
      enabled: enabled,
      label: isLoading ? '$label in progress' : label,
      hint: !isLoading && !enabled ? disabledHint : null,
      liveRegion: isLoading,
      child: ExcludeSemantics(
        child: SizedBox(
          width: double.infinity,
          child: FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(47),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              disabledBackgroundColor: solidWhenDisabled
                  ? action.withValues(alpha: 0.45)
                  : null,
              disabledForegroundColor: solidWhenDisabled ? onAction : null,
            ),
            onPressed: enabled ? onPressed : null,
            child: isLoading
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                  )
                : Text(label),
          ),
        ),
      ),
    );
  }
}
