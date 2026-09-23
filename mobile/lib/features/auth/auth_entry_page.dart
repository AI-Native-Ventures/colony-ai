import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_build_config.dart';
import 'create_account_page.dart';
import 'sign_in_page.dart';

/// First-run account choices. Existing identity pairing is provided as an
/// advanced route by the app composition root.
class AuthEntryPage extends HookConsumerWidget {
  const AuthEntryPage({required this.advancedIdentityPageBuilder, super.key});

  final WidgetBuilder advancedIdentityPageBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(accountAuthProvider);
    final hasGoogleBuildConfig =
        AccountBuildConfig.googleServerClientId.isNotEmpty &&
        (defaultTargetPlatform != TargetPlatform.iOS ||
            AccountBuildConfig.googleIosClientId.isNotEmpty) &&
        (defaultTargetPlatform == TargetPlatform.iOS ||
            defaultTargetPlatform == TargetPlatform.android);
    Future<void> continueWithGoogle() async {
      await ref.read(accountAuthProvider.notifier).continueWithGoogle();
    }

    void openPage(Widget page) {
      ref.read(accountAuthProvider.notifier).reset();
      Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: (_) => page));
    }

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.all(Grid.gutter),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: constraints.maxHeight - (Grid.gutter * 2),
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Welcome to Buzz',
                        style: context.textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'Create an account or sign in to continue.',
                        style: context.textTheme.bodyMedium,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: Grid.md),
                      AccountAuthErrorText(failure: auth.failure),
                      AccountActionButton(
                        label: 'Create account',
                        onPressed: () => openPage(const CreateAccountPage()),
                      ),
                      const SizedBox(height: Grid.xxs),
                      AccountActionButton(
                        label: 'Continue with Google',
                        onPressed: hasGoogleBuildConfig
                            ? continueWithGoogle
                            : null,
                        isLoading: auth.isLoading,
                      ),
                      if (!hasGoogleBuildConfig) ...[
                        const SizedBox(height: Grid.xxs),
                        Text(
                          'Google sign-in is not available in this build.',
                          style: context.textTheme.bodySmall,
                          textAlign: TextAlign.center,
                        ),
                      ],
                      const SizedBox(height: Grid.xxs),
                      TextButton(
                        onPressed: auth.isLoading
                            ? null
                            : () => openPage(const SignInPage()),
                        child: const Text('Sign in'),
                      ),
                      TextButton(
                        onPressed: auth.isLoading
                            ? null
                            : () {
                                ref.read(accountAuthProvider.notifier).reset();
                                Navigator.of(context).push<void>(
                                  MaterialPageRoute<void>(
                                    builder: advancedIdentityPageBuilder,
                                  ),
                                );
                              },
                        child: const Text(
                          'Advanced: use an existing Nostr identity',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
