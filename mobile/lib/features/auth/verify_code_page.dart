import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_code_input.dart';
import 'account_flow_palette.dart';
import 'account_flow_result_page.dart';
import 'account_page_scaffold.dart';
import 'confirm_password_reset_page.dart';

/// Six-digit email code screen for signup, account claim and password reset.
class VerifyCodePage extends HookConsumerWidget {
  const VerifyCodePage({
    required this.email,
    this.purpose = AccountCodePurpose.verify,
    super.key,
  });

  final String email;
  final AccountCodePurpose purpose;

  bool get _isReset => purpose == AccountCodePurpose.reset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = useState('');
    final codeKey = useState(0);
    final notice = useState<String?>(null);
    final auth = ref.watch(accountAuthProvider);
    final brightness = Theme.of(context).brightness;
    final normalisedEmail = email.trim().toLowerCase();

    Future<void> submit() async {
      if (code.value.length != 6 || auth.isLoading) return;
      if (_isReset) {
        ref
            .read(accountAuthProvider.notifier)
            .stagePasswordResetCode(email: normalisedEmail, code: code.value);
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => ConfirmPasswordResetPage(email: normalisedEmail),
          ),
        );
        return;
      }

      await ref
          .read(accountAuthProvider.notifier)
          .verifyCode(email: normalisedEmail, code: code.value);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status == AccountAuthStatus.complete) {
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const AccountFlowResultPage(
              kind: AccountFlowResultKind.emailVerified,
            ),
          ),
        );
      }
    }

    Future<void> resend() async {
      notice.value = null;
      await ref
          .read(accountAuthProvider.notifier)
          .resendCode(email: normalisedEmail, purpose: purpose);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status ==
          AccountAuthStatus.verificationSent) {
        notice.value = _isReset
            ? 'If an account uses this email, a new code has been sent.'
            : 'A new code has been sent.';
        code.value = '';
        codeKey.value += 1;
      }
    }

    final emailDescription = _isReset
        ? 'If an account exists for this address, we’ll send a six-digit reset code.'
        : 'Enter the six-digit code sent to your email.';

    return AccountPageScaffold(
      title: 'Check your email',
      description: emailDescription,
      titleTopSpacing: 0,
      descriptionChildrenSpacing: 17,
      footer: AccountActionButton(
        label: 'Continue',
        isLoading: auth.isLoading,
        onPressed: auth.isLoading || code.value.length != 6 ? null : submit,
      ),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                normalisedEmail,
                style: context.textTheme.bodyMedium?.copyWith(
                  fontSize: 13,
                  color: AccountFlowPalette.ink(brightness),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            TextButton(
              onPressed: auth.isLoading
                  ? null
                  : () => Navigator.of(context).maybePop(),
              child: const Text('Change email'),
            ),
          ],
        ),
        const SizedBox(height: Grid.xs),
        AccountCodeInput(
          key: ValueKey(codeKey.value),
          label: _isReset
              ? 'Six-digit password reset code'
              : 'Six-digit email verification code',
          onChanged: (value) => code.value = value,
        ),
        const SizedBox(height: Grid.twelve),
        Text(
          'You can paste the whole code.',
          style: context.textTheme.bodySmall?.copyWith(
            fontSize: 12,
            color: AccountFlowPalette.muted(brightness),
          ),
        ),
        if (notice.value != null) ...[
          const SizedBox(height: Grid.sm),
          Semantics(
            liveRegion: true,
            child: Text(
              notice.value!,
              style: context.textTheme.bodySmall?.copyWith(
                color: AccountFlowPalette.blue(brightness),
              ),
            ),
          ),
        ],
        const SizedBox(height: Grid.xl + Grid.half),
        AccountAuthErrorText(failure: auth.failure),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              'Didn’t get an email?',
              style: context.textTheme.bodySmall?.copyWith(
                fontSize: 12,
                color: AccountFlowPalette.muted(brightness),
              ),
            ),
            TextButton(
              onPressed: auth.isLoading ? null : resend,
              child: const Text('Resend code'),
            ),
          ],
        ),
      ],
    );
  }
}
