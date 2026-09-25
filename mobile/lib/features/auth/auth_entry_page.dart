import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import 'account_action_button.dart';
import 'account_auth_error_text.dart';
import 'account_auth_provider.dart';
import 'account_flow_palette.dart';
import 'account_flow_components.dart';
import 'account_page_scaffold.dart';
import 'create_account_page.dart';
import 'sign_in_page.dart';

/// First-run account choices. Existing identity pairing is composed by the app.
class AuthEntryPage extends HookConsumerWidget {
  const AuthEntryPage({required this.advancedIdentityPageBuilder, super.key});

  final WidgetBuilder advancedIdentityPageBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(accountAuthProvider);
    final brightness = Theme.of(context).brightness;

    void openPage(Widget page) {
      ref.read(accountAuthProvider.notifier).reset();
      Navigator.of(
        context,
      ).push<void>(MaterialPageRoute<void>(builder: (_) => page));
    }

    return AccountPageScaffold(
      showBackButton: false,
      title: null,
      description: null,
      showHeroBackground: true,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AccountActionButton(
            label: 'Create an account',
            onPressed: auth.isLoading
                ? null
                : () => openPage(const CreateAccountPage()),
            isLoading: false,
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 44,
            child: TextButton(
              style: TextButton.styleFrom(
                foregroundColor: AccountFlowPalette.ink(brightness),
                backgroundColor: AccountFlowPalette.soft(brightness),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.button),
                ),
              ),
              onPressed: auth.isLoading
                  ? null
                  : () => openPage(const SignInPage()),
              child: const Text('I already have an account'),
            ),
          ),
          const SizedBox(height: 4),
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
            child: const Text('Advanced: use an existing Nostr identity'),
          ),
        ],
      ),
      children: [
        if (auth.failure != null) ...[
          AccountAuthErrorText(failure: auth.failure),
          const SizedBox(height: Grid.md),
        ],
        const AccountBrandMark(),
        const SizedBox(height: Grid.md),
        Text(
          'A HOME FOR YOUR BUSINESS',
          style: context.textTheme.labelSmall?.copyWith(
            fontSize: 10,
            color: AccountFlowPalette.muted(brightness),
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5,
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          header: true,
          child: Text(
            'Good people.\nGreat agents.\nYour next chapter.',
            style: context.textTheme.headlineLarge?.copyWith(
              fontSize: 37,
              color: AccountFlowPalette.ink(brightness),
              fontWeight: FontWeight.w700,
              letterSpacing: -1.6,
              height: 1.12,
            ),
          ),
        ),
        const SizedBox(height: 26),
        Text(
          'Bring the work, the conversations and the people behind your business together.',
          style: context.textTheme.bodyMedium?.copyWith(
            fontSize: 13,
            color: AccountFlowPalette.muted(brightness),
            height: 1.7,
          ),
        ),
        const SizedBox(height: 30),
        const _WelcomeMemberCard(
          initials: 'MN',
          name: 'Maya',
          role: 'Your creative partner',
          initialsColor: Color(0xFFF4E7E1),
          initialsInk: Color(0xFF9A6E5D),
          icon: LucideIcons.check,
        ),
        Padding(
          padding: const EdgeInsets.only(left: Grid.lg),
          child: const _WelcomeMemberCard(
            initials: 'S',
            name: 'Scout',
            role: 'Your research agent',
            initialsColor: Color(0xFFE7F0E7),
            initialsInk: Color(0xFF62836A),
            icon: LucideIcons.activity,
          ),
        ),
      ],
    );
  }
}

class _WelcomeMemberCard extends StatelessWidget {
  const _WelcomeMemberCard({
    required this.initials,
    required this.name,
    required this.role,
    required this.initialsColor,
    required this.initialsInk,
    required this.icon,
  });

  final String initials;
  final String name;
  final String role;
  final Color initialsColor;
  final Color initialsInk;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AccountFlowPalette.paper(brightness),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AccountFlowPalette.line(brightness)),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: initialsColor,
              borderRadius: BorderRadius.circular(Radii.md),
            ),
            child: Text(
              initials,
              style: context.textTheme.labelSmall?.copyWith(
                fontSize: 10,
                color: initialsInk,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: Grid.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: context.textTheme.bodySmall?.copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.quarter),
                Text(
                  role,
                  style: context.textTheme.labelSmall?.copyWith(
                    fontSize: 10,
                    color: AccountFlowPalette.muted(brightness),
                  ),
                ),
              ],
            ),
          ),
          Icon(icon, size: 15, color: AccountFlowPalette.ink(brightness)),
        ],
      ),
    );
  }
}
