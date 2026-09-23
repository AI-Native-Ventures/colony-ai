import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_auth_provider.dart';
import 'account_claim_status_provider.dart';
import 'account_auth_types.dart';
import 'claim_account_page.dart';

/// Persistent, non-blocking account claim prompt for key-only identities.
class AccountClaimPrompt extends ConsumerWidget {
  const AccountClaimPrompt({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final link = ref.watch(accountLinkStatusProvider);
    final data = link.asData?.value;
    if (data == null || data.status == AccountLinkStatus.linked) {
      return const SizedBox.shrink();
    }

    final needsClaim = data.status == AccountLinkStatus.needsClaim;
    return Card(
      margin: const EdgeInsets.fromLTRB(Grid.gutter, Grid.sm, Grid.gutter, 0),
      child: Padding(
        padding: const EdgeInsets.all(Grid.sm),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    needsClaim
                        ? 'Add an account'
                        : 'Account connection unavailable',
                    style: context.textTheme.titleSmall,
                  ),
                  const SizedBox(height: Grid.quarter),
                  Text(
                    needsClaim
                        ? 'Add email sign-in so you can get back into this identity.'
                        : 'Try again later. You can keep using the app.',
                    style: context.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: Grid.xxs),
            if (needsClaim)
              TextButton(
                onPressed: () {
                  ref.read(accountAuthProvider.notifier).reset();
                  Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(
                      builder: (_) => const ClaimAccountPage(),
                    ),
                  );
                },
                child: const Text('Set up'),
              )
            else
              TextButton(
                onPressed: () => ref.invalidate(accountLinkStatusProvider),
                child: const Text('Try again'),
              ),
          ],
        ),
      ),
    );
  }
}
