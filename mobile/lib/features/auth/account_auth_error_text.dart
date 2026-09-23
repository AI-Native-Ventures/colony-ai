import 'package:flutter/material.dart';

import 'account_auth_failure_copy.dart';
import 'account_auth_types.dart';

/// An accessible inline message for a failed account action.
class AccountAuthErrorText extends StatelessWidget {
  const AccountAuthErrorText({required this.failure, super.key});

  final AccountAuthFailure? failure;

  @override
  Widget build(BuildContext context) {
    final value = failure;
    if (value == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(
          accountAuthFailureCopy(value),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
