import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';
import 'request_password_reset_page.dart';
import 'verify_code_page.dart';

/// Email and password sign-in screen.
class SignInPage extends HookConsumerWidget {
  const SignInPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final email = useTextEditingController();
    final password = useTextEditingController();
    final auth = ref.watch(accountAuthProvider);
    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false)) return;
      await ref
          .read(accountAuthProvider.notifier)
          .signIn(email: email.text, password: password.text);
      if (!context.mounted) return;
      final result = ref.read(accountAuthProvider);
      if (result.status == AccountAuthStatus.verificationSent) {
        ref.read(accountAuthProvider.notifier).reset();
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => VerifyCodePage(email: email.text.trim()),
          ),
        );
      }
    }

    return AccountPageScaffold(
      title: 'Sign in',
      description: 'Use the email and password for your account.',
      children: [
        Form(
          key: formKey,
          child: Column(
            children: [
              AccountTextField(
                controller: email,
                label: 'Email',
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
                validator: _validateSignInEmail,
              ),
              const SizedBox(height: Grid.sm),
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
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: auth.isLoading
                ? null
                : () {
                    ref.read(accountAuthProvider.notifier).reset();
                    Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(
                        builder: (_) => const RequestPasswordResetPage(),
                      ),
                    );
                  },
            child: const Text('Forgot password?'),
          ),
        ),
        AccountAuthErrorText(failure: auth.failure),
        AccountActionButton(
          label: 'Sign in',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : submit,
        ),
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
