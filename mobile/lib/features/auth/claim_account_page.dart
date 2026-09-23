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
import 'verify_code_page.dart';

/// Email and password form for linking the current identity to an account.
class ClaimAccountPage extends HookConsumerWidget {
  const ClaimAccountPage({super.key});

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
          .claimAccount(email: email.text, password: password.text);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status ==
          AccountAuthStatus.verificationSent) {
        ref.read(accountAuthProvider.notifier).reset();
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => VerifyCodePage(email: email.text.trim()),
          ),
        );
      }
    }

    return AccountPageScaffold(
      title: 'Create an account',
      description:
          'Add email sign-in to this identity. We will send a code to verify your email.',
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
                validator: _validateEmail,
              ),
              const SizedBox(height: Grid.sm),
              AccountTextField(
                controller: password,
                label: 'Password',
                obscureText: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.newPassword],
                onFieldSubmitted: (_) => submit(),
                validator: _validatePassword,
              ),
            ],
          ),
        ),
        const SizedBox(height: Grid.sm),
        AccountAuthErrorText(failure: auth.failure),
        AccountActionButton(
          label: 'Continue',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : submit,
        ),
      ],
    );
  }
}

String? _validateEmail(String? value) {
  final email = value?.trim() ?? '';
  if (!email.contains('@') || email.startsWith('@') || email.endsWith('@')) {
    return 'Enter a valid email address.';
  }
  return null;
}

String? _validatePassword(String? value) {
  if ((value ?? '').length < 10) return 'Use at least 10 characters.';
  return null;
}
