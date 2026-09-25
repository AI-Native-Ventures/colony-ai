import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';
import 'verify_code_page.dart';

/// Requests a password reset code without revealing whether an email exists.
class RequestPasswordResetPage extends HookConsumerWidget {
  const RequestPasswordResetPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final email = useTextEditingController();
    final auth = ref.watch(accountAuthProvider);
    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false)) return;
      await ref
          .read(accountAuthProvider.notifier)
          .requestPasswordReset(email: email.text);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status ==
          AccountAuthStatus.verificationSent) {
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => VerifyCodePage(
              email: email.text.trim(),
              purpose: AccountCodePurpose.reset,
            ),
          ),
        );
      }
    }

    return AccountPageScaffold(
      title: 'Reset your password',
      description:
          'Enter your email and we’ll send a six-digit code to reset your password.',
      titleTopSpacing: 0,
      footer: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AccountActionButton(
            label: 'Send code',
            isLoading: auth.isLoading,
            onPressed: auth.isLoading ? null : submit,
          ),
          TextButton(
            onPressed: auth.isLoading
                ? null
                : () => Navigator.of(context).maybePop(),
            child: const Text('Back to sign in'),
          ),
        ],
      ),
      children: [
        Form(
          key: formKey,
          child: AccountTextField(
            controller: email,
            label: 'Email address',
            useSoftFill: true,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            onFieldSubmitted: (_) => submit(),
            validator: _validateEmail,
          ),
        ),
        AccountAuthErrorText(failure: auth.failure),
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
