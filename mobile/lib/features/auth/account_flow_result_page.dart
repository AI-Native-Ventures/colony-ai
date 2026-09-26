import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_route_scope.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_provider.dart';
import 'account_flow_palette.dart';
import 'account_page_scaffold.dart';
import 'sign_in_page.dart';

enum AccountFlowResultKind { emailVerified, passwordUpdated }

/// Confirmation screen used after the account service accepts a code flow.
class AccountFlowResultPage extends ConsumerWidget {
  const AccountFlowResultPage({required this.kind, super.key});

  final AccountFlowResultKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final passwordUpdated = kind == AccountFlowResultKind.passwordUpdated;
    final brightness = Theme.of(context).brightness;
    return AccountPageScaffold(
      footer: AccountActionButton(
        label: passwordUpdated ? 'Back to sign in' : 'Continue to setup',
        onPressed: () async {
          if (passwordUpdated) {
            ref.read(accountAuthProvider.notifier).reset();
            await Navigator.of(context).pushAndRemoveUntil<void>(
              MaterialPageRoute<void>(builder: (_) => const SignInPage()),
              (_) => false,
            );
          } else {
            await MobileRouteScope.push<NoMobileRouteArguments, void>(
              context,
              MobileRoutes.accountAge,
              const NoMobileRouteArguments(),
            );
          }
        },
      ),
      children: [
        Semantics(
          header: true,
          child: Text(
            passwordUpdated ? 'Password updated' : 'Email verified',
            style: context.textTheme.headlineMedium?.copyWith(
              fontSize: 28,
              color: AccountFlowPalette.ink(brightness),
              fontWeight: FontWeight.w700,
              letterSpacing: -1.1,
              height: 1.13,
            ),
          ),
        ),
        const SizedBox(height: Grid.xs),
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AccountFlowPalette.successContainer(brightness),
              borderRadius: BorderRadius.circular(24),
            ),
            alignment: Alignment.center,
            child: Icon(
              Icons.check_rounded,
              size: 20,
              color: AccountFlowPalette.onSuccessContainer(brightness),
            ),
          ),
        ),
        const SizedBox(height: Grid.xs),
        Text(
          passwordUpdated
              ? 'You can now sign in with your new password.'
              : 'You’re ready to set up your business.',
          style: context.textTheme.bodyMedium?.copyWith(
            fontSize: 13,
            color: AccountFlowPalette.muted(brightness),
            height: 1.7,
          ),
        ),
      ],
    );
  }
}
