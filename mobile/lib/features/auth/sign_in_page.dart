import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_build_config.dart';
import 'account_flow_components.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';
import 'create_account_page.dart';
import 'request_password_reset_page.dart';
import 'verify_code_page.dart';

/// Email, password, and Google sign-in screen.
class SignInPage extends HookConsumerWidget {
  final WidgetBuilder? pairIdentityPageBuilder;

  const SignInPage({this.pairIdentityPageBuilder, super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final email = useTextEditingController();
    final password = useTextEditingController();
    final auth = ref.watch(accountAuthProvider);
    final hasGoogleBuildConfig =
        AccountBuildConfig.googleServerClientId.isNotEmpty &&
        (defaultTargetPlatform != TargetPlatform.iOS ||
            AccountBuildConfig.googleIosClientId.isNotEmpty) &&
        (defaultTargetPlatform == TargetPlatform.iOS ||
            defaultTargetPlatform == TargetPlatform.android);

    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false)) return;
      await ref
          .read(accountAuthProvider.notifier)
          .signIn(email: email.text, password: password.text);
      if (!context.mounted) return;
      final result = ref.read(accountAuthProvider);
      if (result.status == AccountAuthStatus.verificationSent) {
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => VerifyCodePage(
              email: result.email ?? email.text,
              pairIdentityPageBuilder: pairIdentityPageBuilder,
            ),
          ),
        );
      }
    }

    Future<void> continueWithGoogle() async {
      await ref.read(accountAuthProvider.notifier).continueWithGoogle();
    }

    void openPage(Widget page) {
      ref.read(accountAuthProvider.notifier).reset();
      Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: (_) => page));
    }

    void pairWithDesktop() {
      final builder = pairIdentityPageBuilder;
      if (builder == null) return;
      ref.read(accountAuthProvider.notifier).reset();
      Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: builder));
    }

    return AccountPageScaffold(
      title: 'Welcome back.',
      description: 'One account. All your businesses.',
      children: [
        AccountGoogleButton(
          onPressed: hasGoogleBuildConfig ? continueWithGoogle : null,
          isLoading: auth.isLoading,
        ),
        const AccountOrDivider(),
        Form(
          key: formKey,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AccountTextField(
                  controller: email,
                  label: 'Email',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  validator: _validateSignInEmail,
                ),
                const SizedBox(height: 24),
                AccountTextField(
                  controller: password,
                  label: 'Password',
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.password],
                  onFieldSubmitted: (_) => submit(),
                  validator: (value) =>
                      (value ?? '').isEmpty ? 'Enter your password.' : null,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: auth.isLoading
                ? null
                : () => openPage(
                    RequestPasswordResetPage(
                      pairIdentityPageBuilder: pairIdentityPageBuilder,
                    ),
                  ),
            child: const Text('Forgot password?'),
          ),
        ),
        const SizedBox(height: 4),
        if (auth.failure != null) ...[
          AccountAuthErrorText(failure: auth.failure),
          const SizedBox(height: Grid.xs),
        ],
        AccountActionButton(
          label: 'Sign in',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : submit,
        ),
        const SizedBox(height: 7),
        AccountSecondaryButton(
          label: 'New to Colony? Create an account',
          onPressed: auth.isLoading
              ? null
              : () => openPage(
                  CreateAccountPage(
                    pairIdentityPageBuilder: pairIdentityPageBuilder,
                  ),
                ),
        ),
        if (pairIdentityPageBuilder != null) ...[
          const SizedBox(height: 32),
          TextButton(
            onPressed: auth.isLoading ? null : pairWithDesktop,
            child: const Text('Pair with my desktop'),
          ),
        ],
      ],
    );
  }
}

String? _validateSignInEmail(String? value) {
  final email = value?.trim() ?? '';
  if (!email.contains('@') || email.startsWith('@') || email.endsWith('@')) {
    return 'Enter a valid email address.';
  }
  return null;
}
