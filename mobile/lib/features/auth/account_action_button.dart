import 'package:flutter/material.dart';

/// Full-width account action using the app's existing primary button style.
class AccountActionButton extends StatelessWidget {
  const AccountActionButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        onPressed: isLoading ? null : onPressed,
        child: Semantics(
          label: isLoading ? '$label in progress' : label,
          liveRegion: isLoading,
          child: ExcludeSemantics(
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
