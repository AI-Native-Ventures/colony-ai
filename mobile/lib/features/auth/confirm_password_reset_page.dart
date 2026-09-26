import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_auth_types.dart';
import 'account_flow_palette.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';
import 'account_flow_result_page.dart';

/// Sets and confirms a password after a reset code was entered.
class ConfirmPasswordResetPage extends HookConsumerWidget {
  final WidgetBuilder? pairIdentityPageBuilder;

  const ConfirmPasswordResetPage({
    required this.email,
    this.pairIdentityPageBuilder,
    super.key,
  });

  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final password = useTextEditingController();
    final confirmation = useTextEditingController();
    final showPasswords = useState(false);
    final auth = ref.watch(accountAuthProvider);
    final brightness = Theme.of(context).brightness;

    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false) || auth.isLoading) {
        return;
      }
      await ref
          .read(accountAuthProvider.notifier)
          .confirmPasswordReset(email: email, newPassword: password.text);
      if (!context.mounted) return;
      if (ref.read(accountAuthProvider).status ==
          AccountAuthStatus.resetComplete) {
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => AccountFlowResultPage(
              kind: AccountFlowResultKind.passwordUpdated,
              pairIdentityPageBuilder: pairIdentityPageBuilder,
            ),
          ),
        );
      } else {
        final failure = ref.read(accountAuthProvider).failure;
        if (failure != null &&
            const {
              AccountAuthFailureKind.codeExpired,
              AccountAuthFailureKind.wrongCode,
              AccountAuthFailureKind.tooManyAttempts,
              AccountAuthFailureKind.resendCooldown,
            }.contains(failure.kind)) {
          Navigator.of(context).pop();
        }
      }
    }

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop && auth.status != AccountAuthStatus.resetComplete) {
          ref
              .read(accountAuthProvider.notifier)
              .discardStagedPasswordResetCode();
        }
      },
      child: AccountPageScaffold(
        title: 'Choose a new password',
        description: 'Your email is verified.\n$email',
        titleTopSpacing: 0,
        titleDescriptionSpacing: 10,
        descriptionChildrenSpacing: 26,
        footer: AccountActionButton(
          label: 'Update password',
          isLoading: auth.isLoading,
          onPressed: auth.isLoading ? null : submit,
        ),
        children: [
          Form(
            key: formKey,
            child: Column(
              children: [
                AccountTextField(
                  controller: password,
                  label: 'New password',
                  labelFieldSpacing: 11,
                  useSoftFill: true,
                  obscureText: !showPasswords.value,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newPassword],
                  validator: _validatePassword,
                ),
                const SizedBox(height: 19),
                AccountTextField(
                  controller: confirmation,
                  label: 'Confirm new password',
                  labelFieldSpacing: 9,
                  useSoftFill: true,
                  obscureText: !showPasswords.value,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => submit(),
                  validator: (value) =>
                      value == password.text ? null : 'Passwords do not match.',
                ),
                const SizedBox(height: 20),
                Semantics(
                  container: true,
                  label: 'Show passwords',
                  checked: showPasswords.value,
                  onTap: () => showPasswords.value = !showPasswords.value,
                  child: ExcludeSemantics(
                    child: InkWell(
                      excludeFromSemantics: true,
                      onTap: () => showPasswords.value = !showPasswords.value,
                      child: SizedBox(
                        height: 44,
                        child: Row(
                          children: [
                            Container(
                              width: 14,
                              height: 14,
                              decoration: BoxDecoration(
                                color: showPasswords.value
                                    ? AccountFlowPalette.blue(brightness)
                                    : AccountFlowPalette.paper(brightness),
                                borderRadius: BorderRadius.circular(2),
                                border: Border.all(
                                  color: AccountFlowPalette.muted(brightness),
                                ),
                              ),
                              child: showPasswords.value
                                  ? const Icon(
                                      Icons.check,
                                      size: 11,
                                      color: Colors.white,
                                    )
                                  : null,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              'Show passwords',
                              style: context.textTheme.bodySmall?.copyWith(
                                fontSize: 12,
                                color: AccountFlowPalette.ink(brightness),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (auth.failure == null) ...[
            const SizedBox(height: Grid.xxs),
            Text(
              'Use a password with at least 10 characters.',
              style: context.textTheme.bodySmall?.copyWith(
                fontSize: 11,
                color: AccountFlowPalette.muted(brightness),
              ),
            ),
          ],
          const SizedBox(height: Grid.xs),
          AccountAuthErrorText(failure: auth.failure),
        ],
      ),
    );
  }
}

String? _validatePassword(String? value) =>
    (value ?? '').isEmpty ? 'Enter a new password.' : null;
