import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';

/// Confirms an email reset code and signs into the restored account.
class ConfirmPasswordResetPage extends HookConsumerWidget {
  const ConfirmPasswordResetPage({required this.email, super.key});

  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final code = useTextEditingController();
    final password = useTextEditingController();
    final notice = useState<String?>(null);
    final auth = ref.watch(accountAuthProvider);
    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false)) return;
      await ref
          .read(accountAuthProvider.notifier)
          .confirmPasswordReset(
            email: email,
            code: code.text,
            newPassword: password.text,
          );
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status == AccountAuthStatus.complete) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    }

    return AccountPageScaffold(
      title: 'Choose a new password',
      description:
          'If an account uses $email, enter its reset code and a new password.',
      children: [
        Form(
          key: formKey,
          child: Column(
            children: [
              AccountTextField(
                controller: code,
                label: '6-digit code',
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.next,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                validator: (value) => (value ?? '').trim().length == 6
                    ? null
                    : 'Enter the six-digit code.',
              ),
              const SizedBox(height: Grid.sm),
              AccountTextField(
                controller: password,
                label: 'New password',
                obscureText: true,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.newPassword],
                onFieldSubmitted: (_) => submit(),
                validator: _validatePassword,
              ),
            ],
          ),
        ),
        if (notice.value != null) ...[
          const SizedBox(height: Grid.xxs),
          Semantics(liveRegion: true, child: Text(notice.value!)),
        ],
        const SizedBox(height: Grid.sm),
        AccountAuthErrorText(failure: auth.failure),
        AccountActionButton(
          label: 'Reset password',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : submit,
        ),
        const SizedBox(height: Grid.xxs),
        TextButton(
          onPressed: auth.isLoading
              ? null
              : () async {
                  notice.value = null;
                  await ref
                      .read(accountAuthProvider.notifier)
                      .resendCode(
                        email: email,
                        purpose: AccountCodePurpose.reset,
                      );
                  if (!context.mounted) return;
                  if (ref.read(accountAuthProvider).status ==
                      AccountAuthStatus.verificationSent) {
                    notice.value =
                        'If an account uses this email, a new code has been sent.';
                  }
                },
          child: const Text('Send a new code'),
        ),
      ],
    );
  }
}

String? _validatePassword(String? value) {
  if ((value ?? '').length < 10) return 'Use at least 10 characters.';
  return null;
}
