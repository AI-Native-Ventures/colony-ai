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
import 'account_flow_palette.dart';
import 'account_flow_components.dart';
import 'account_page_scaffold.dart';
import 'account_text_field.dart';
import 'sign_in_page.dart';
import 'verify_code_page.dart';

/// Email and password signup screen.
class CreateAccountPage extends HookConsumerWidget {
  const CreateAccountPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final brightness = Theme.of(context).brightness;
    final name = useTextEditingController();
    final email = useTextEditingController();
    final password = useTextEditingController();
    final termsAccepted = useState(false);
    final auth = ref.watch(accountAuthProvider);
    final hasGoogleBuildConfig =
        AccountBuildConfig.googleServerClientId.isNotEmpty &&
        (defaultTargetPlatform != TargetPlatform.iOS ||
            AccountBuildConfig.googleIosClientId.isNotEmpty) &&
        (defaultTargetPlatform == TargetPlatform.iOS ||
            defaultTargetPlatform == TargetPlatform.android);

    Future<void> submit() async {
      if (!(formKey.currentState?.validate() ?? false) ||
          !termsAccepted.value) {
        return;
      }
      await ref
          .read(accountAuthProvider.notifier)
          .signUp(email: email.text, password: password.text);
      if (!context.mounted) return;
      final result = ref.read(accountAuthProvider);
      if (result.status == AccountAuthStatus.verificationSent) {
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => VerifyCodePage(email: result.email ?? email.text),
          ),
        );
      }
    }

    Future<void> continueWithGoogle() async {
      await ref.read(accountAuthProvider.notifier).continueWithGoogle();
    }

    void openSignIn() {
      ref.read(accountAuthProvider.notifier).reset();
      Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: (_) => const SignInPage()));
    }

    return AccountPageScaffold(
      title: 'Make yourself at home.',
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
                  controller: name,
                  label: 'Your name',
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  validator: _validateName,
                ),
                const SizedBox(height: 20),
                AccountTextField(
                  controller: email,
                  label: 'Email',
                  labelFieldSpacing: 11,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  validator: _validateEmail,
                ),
                const SizedBox(height: 20),
                AccountTextField(
                  controller: password,
                  label: 'Password',
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.newPassword],
                  onFieldSubmitted: (_) => submit(),
                  validator: (value) =>
                      (value ?? '').isEmpty ? 'Enter a password.' : null,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 21),
        Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: AccountFlowPalette.line(brightness)),
            ),
          ),
          child: MergeSemantics(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'I agree to the Terms and Privacy Policy',
                        style: context.textTheme.bodySmall?.copyWith(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AccountFlowPalette.ink(brightness),
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        'Review the terms before creating your account.',
                        style: context.textTheme.labelSmall?.copyWith(
                          fontSize: 11,
                          height: 1.5,
                          color: AccountFlowPalette.muted(brightness),
                        ),
                      ),
                    ],
                  ),
                ),
                Checkbox(
                  value: termsAccepted.value,
                  onChanged: auth.isLoading
                      ? null
                      : (value) => termsAccepted.value = value ?? false,
                ),
              ],
            ),
          ),
        ),
        if (auth.failure != null) ...[
          const SizedBox(height: Grid.xs),
          AccountAuthErrorText(failure: auth.failure),
        ],
        const SizedBox(height: 5),
        AccountActionButton(
          label: 'Create account',
          isLoading: auth.isLoading,
          disabledHint: termsAccepted.value
              ? null
              : 'Agree to the Terms and Privacy Policy to create your account.',
          solidWhenDisabled: !termsAccepted.value,
          onPressed: auth.isLoading || !termsAccepted.value ? null : submit,
        ),
        const SizedBox(height: 4),
        AccountSecondaryButton(
          label: 'Already a member? Sign in',
          onPressed: auth.isLoading ? null : openSignIn,
        ),
      ],
    );
  }
}

String? _validateName(String? value) =>
    value?.trim().isNotEmpty == true ? null : 'Enter your name.';

String? _validateEmail(String? value) {
  final email = value?.trim() ?? '';
  if (!email.contains('@') || email.startsWith('@') || email.endsWith('@')) {
    return 'Enter a valid email address.';
  }
  return null;
}
