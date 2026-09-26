import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_code_status_callout.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_auth_failure_copy.dart';
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
    this.pairIdentityPageBuilder,
    super.key,
  });

  final String email;
  final AccountCodePurpose purpose;
  final WidgetBuilder? pairIdentityPageBuilder;

  bool get _isReset => purpose == AccountCodePurpose.reset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final code = useState('');
    final codeKey = useState(0);
    final notice = useState(false);
    final auth = ref.watch(accountAuthProvider);
    final remainingSecs = useState(auth.retryAfterSecs ?? 0);
    final brightness = Theme.of(context).brightness;
    final normalisedEmail = email.trim().toLowerCase();
    final failure = auth.failure;
    final lockWait = auth.retryAfterSecs ?? failure?.retryAfterSecs ?? 0;
    final lockWaitElapsed =
        failure?.kind == AccountAuthFailureKind.tooManyAttempts &&
        lockWait > 0 &&
        remainingSecs.value == 0;
    final statusFailure = lockWaitElapsed
        ? const AccountAuthFailure(AccountAuthFailureKind.codeExpired)
        : failure;
    final isExpired =
        failure?.kind == AccountAuthFailureKind.codeExpired || lockWaitElapsed;
    final isWrongCode = failure?.kind == AccountAuthFailureKind.wrongCode;
    final isLocked =
        failure?.kind == AccountAuthFailureKind.tooManyAttempts &&
        !lockWaitElapsed;
    final resendEnabled = !auth.isLoading && remainingSecs.value == 0;

    useEffect(() {
      remainingSecs.value = auth.retryAfterSecs ?? 0;
      if (remainingSecs.value <= 0) return null;
      final timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (remainingSecs.value <= 1) {
          remainingSecs.value = 0;
          timer.cancel();
        } else {
          remainingSecs.value--;
        }
      });
      return timer.cancel;
    }, [auth.retryAfterSecs]);

    Future<void> submit() async {
      if (code.value.length != 6 || auth.isLoading) return;
      if (_isReset) {
        await ref
            .read(accountAuthProvider.notifier)
            .checkPasswordResetCode(email: normalisedEmail, code: code.value);
        if (!context.mounted) return;
        var result = ref.read(accountAuthProvider);
        remainingSecs.value = result.retryAfterSecs ?? 0;
        if (result.status == AccountAuthStatus.codeVerified) {
          await Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => ConfirmPasswordResetPage(
                email: normalisedEmail,
                pairIdentityPageBuilder: pairIdentityPageBuilder,
              ),
            ),
          );
          result = ref.read(accountAuthProvider);
        }
        if (result.status == AccountAuthStatus.failed) {
          remainingSecs.value = result.retryAfterSecs ?? 0;
          code.value = '';
          codeKey.value += 1;
        }
        return;
      }

      await ref
          .read(accountAuthProvider.notifier)
          .verifyCode(email: normalisedEmail, code: code.value);
      if (!context.mounted) return;
      final result = ref.read(accountAuthProvider);
      remainingSecs.value = result.retryAfterSecs ?? 0;
      if (result.status == AccountAuthStatus.complete) {
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const AccountFlowResultPage(
              kind: AccountFlowResultKind.emailVerified,
            ),
          ),
        );
      } else if (result.failure != null) {
        code.value = '';
        codeKey.value += 1;
      }
    }

    Future<void> resend() async {
      notice.value = false;
      await ref
          .read(accountAuthProvider.notifier)
          .resendCode(email: normalisedEmail, purpose: purpose);
      if (!context.mounted) return;
      final result = ref.read(accountAuthProvider);
      remainingSecs.value = result.retryAfterSecs ?? 0;
      if (result.status == AccountAuthStatus.verificationSent) {
        notice.value = true;
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
        onPressed:
            auth.isLoading || code.value.length != 6 || isExpired || isLocked
            ? null
            : submit,
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
          enabled: !auth.isLoading && !isExpired && !isLocked,
          isInvalid: isWrongCode,
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
        if (notice.value)
          const AccountCodeStatusCallout(
            title: 'A new code is on its way.',
            detail:
                'Use the latest email. Your previous code is no longer valid.',
            isSuccess: true,
          ),
        if (statusFailure != null &&
            accountCodeStatusTitle(statusFailure) != null) ...[
          const SizedBox(height: Grid.xs),
          AccountCodeStatusCallout(
            title: accountCodeStatusTitle(statusFailure)!,
            detail: accountCodeStatusDetail(
              statusFailure,
              remainingSecs: remainingSecs.value,
            )!,
          ),
        ],
        if (statusFailure != null &&
            accountCodeStatusTitle(statusFailure) == null &&
            statusFailure.kind != AccountAuthFailureKind.resendCooldown)
          AccountAuthErrorText(failure: statusFailure),
        const SizedBox(height: Grid.xl + Grid.half),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            Text(
              'Didn’t get an email?',
              style: context.textTheme.bodySmall?.copyWith(
                fontSize: 12,
                color: AccountFlowPalette.muted(brightness),
              ),
            ),
            TextButton(
              onPressed: resendEnabled ? resend : null,
              child: Text(
                remainingSecs.value > 0
                    ? 'Resend code in ${remainingSecs.value}s'
                    : 'Resend code',
              ),
            ),
          ],
        ),
      ],
    );
  }
}
