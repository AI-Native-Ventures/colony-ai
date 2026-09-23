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

/// Email verification screen shared by signup, sign-in and account claim.
class VerifyCodePage extends HookConsumerWidget {
  const VerifyCodePage({required this.email, super.key});

  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final code = useTextEditingController();
    final notice = useState<String?>(null);
    final auth = ref.watch(accountAuthProvider);
    Future<void> verify() async {
      if (!(formKey.currentState?.validate() ?? false)) return;
      await ref
          .read(accountAuthProvider.notifier)
          .verifyCode(email: email, code: code.text);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status == AccountAuthStatus.complete) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    }

    Future<void> resend() async {
      notice.value = null;
      await ref
          .read(accountAuthProvider.notifier)
          .resendCode(email: email, purpose: AccountCodePurpose.verify);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status ==
          AccountAuthStatus.verificationSent) {
        notice.value = 'A new code has been sent.';
      }
    }

    return AccountPageScaffold(
      title: 'Check your email',
      description: 'Enter the six-digit code sent to $email.',
      children: [
        Form(
          key: formKey,
          child: AccountTextField(
            controller: code,
            label: '6-digit code',
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onFieldSubmitted: (_) => verify(),
            validator: (value) => (value ?? '').trim().length == 6
                ? null
                : 'Enter the six-digit code.',
          ),
        ),
        if (notice.value != null) ...[
          const SizedBox(height: Grid.xxs),
          Semantics(liveRegion: true, child: Text(notice.value!)),
        ],
        const SizedBox(height: Grid.sm),
        AccountAuthErrorText(failure: auth.failure),
        AccountActionButton(
          label: 'Verify email',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : verify,
        ),
        const SizedBox(height: Grid.xxs),
        TextButton(
          onPressed: auth.isLoading ? null : resend,
          child: const Text('Send a new code'),
        ),
      ],
    );
  }
}
