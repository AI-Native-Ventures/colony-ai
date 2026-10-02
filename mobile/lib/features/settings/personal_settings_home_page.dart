import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Personal settings entry, composed from the identity and community at app level.
class PersonalSettingsHomePage extends StatelessWidget {
  const PersonalSettingsHomePage({
    required this.displayName,
    required this.email,
    required this.avatarUrl,
    this.communityName = '',
    this.onOpenBusiness,
    this.onOpenAgents,
    super.key,
  });

  final String displayName;
  final String? email;
  final String? avatarUrl;
  final String communityName;
  final VoidCallback? onOpenBusiness;
  final VoidCallback? onOpenAgents;

  @override
  Widget build(BuildContext context) {
    final initials = _initials(displayName);
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(
        title: 'Settings',
        backLabel: 'Close settings',
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.twelve,
          Grid.gutter,
          Grid.md,
        ),
        children: [
          const _SettingsWelcomeCard(),
          const SizedBox(height: 29),
          Align(
            alignment: Alignment.centerLeft,
            child: SizedBox(
              width: MediaQuery.sizeOf(context).width - 90,
              child: Row(
                children: [
                  AvatarImage(
                    imageUrl: avatarUrl,
                    radius: 24,
                    backgroundColor: context.mobileTokens.soft,
                    borderRadius: BorderRadius.circular(14.4),
                    fallback: Text(
                      initials,
                      style: context.mobileTypography.identityInitials.copyWith(
                        color: context.mobileTokens.action,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: Grid.twelve),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.conversation.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (email != null)
                          Text(
                            email!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: bodyExtraSmallTextStyle.copyWith(
                              color: context.mobileTokens.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(
                      foregroundColor: context.mobileTokens.action,
                      textStyle: context.mobileTypography.conversation,
                    ),
                    onPressed: () =>
                        MobileNavigation.push<NoMobileRouteArguments, Object?>(
                          context,
                          MobileRoutes.settingsProfile,
                          const NoMobileRouteArguments(),
                        ),
                    child: const Text('Edit'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 39),
          const _SettingsSectionLabel('YOU'),
          const SizedBox(height: 2),
          _PersonalSettingsRow(
            icon: LucideIcons.messageSquare,
            title: 'Account',
            subtitle: 'Profile and sign-in',
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsProfile,
                  const NoMobileRouteArguments(),
                ),
          ),
          _PersonalSettingsRow(
            icon: LucideIcons.image,
            title: 'Appearance',
            subtitle: 'Theme, text and density',
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsAppearance,
                  const NoMobileRouteArguments(),
                ),
          ),
          _PersonalSettingsRow(
            icon: LucideIcons.mic,
            title: 'Preferences',
            subtitle: 'Notifications, voice and accessibility',
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsPreferences,
                  const NoMobileRouteArguments(),
                ),
          ),
          if (communityName.trim().isNotEmpty) ...[
            const SizedBox(height: 29),
            _SettingsSectionLabel(communityName.trim().toUpperCase()),
            const SizedBox(height: 12),
            _PersonalSettingsRow(
              icon: LucideIcons.briefcaseBusiness,
              title: 'Business',
              subtitle: 'People and business profile',
              onPressed: onOpenBusiness,
              compact: true,
            ),
            _PersonalSettingsRow(
              icon: LucideIcons.activity,
              title: 'Agents',
              subtitle: 'Harnesses, models and access',
              onPressed: onOpenAgents,
              compact: true,
            ),
          ],
          const SizedBox(height: Grid.xs),
          TextButton(
            style: TextButton.styleFrom(
              alignment: Alignment.centerLeft,
              textStyle: context.mobileTypography.conversation,
            ),
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsFeedback,
                  const NoMobileRouteArguments(),
                ),
            child: const Text('Send feedback'),
          ),
        ],
      ),
    );
  }
}

class _SettingsWelcomeCard extends StatelessWidget {
  const _SettingsWelcomeCard();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.fromLTRB(21, 28, 21, 28),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? const [Color(0xFF49375C), Color(0xFF513D46)]
              : const [Color(0xFFE5D6E9), Color(0xFFEFDDD1)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'MAKE COLONY YOURS',
            style: context.mobileTypography.metadata.copyWith(
              color: context.mobileTokens.ink,
              fontSize: 9,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'A little more you.',
            style: context.mobileTypography.companyHubTitle.copyWith(
              color: context.mobileTokens.ink,
              fontSize: 21,
              height: 1.2,
              letterSpacing: -0.6,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: 280,
            child: Text(
              'Your profile, appearance and the company settings you can manage.',
              style: context.mobileTypography.conversation.copyWith(
                color: context.mobileTokens.ink,
                fontSize: 13,
                height: 1.55,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PersonalSettingsRow extends StatelessWidget {
  const _PersonalSettingsRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onPressed,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onPressed;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: title,
      onTap: onPressed,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onPressed,
          child: Container(
            constraints: BoxConstraints(minHeight: compact ? 58 : 72),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: context.mobileTokens.line),
              ),
            ),
            padding: EdgeInsets.symmetric(
              vertical: compact ? Grid.half : Grid.twelve,
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: context.mobileTokens.soft,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(
                    icon,
                    size: 19,
                    color: context.mobileTokens.action,
                  ),
                ),
                const SizedBox(width: Grid.ten),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: context.mobileTypography.conversation.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: bodyExtraSmallTextStyle.copyWith(
                          color: context.mobileTokens.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  LucideIcons.arrowRight,
                  size: 16,
                  color: context.mobileTokens.muted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsSectionLabel extends StatelessWidget {
  const _SettingsSectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label,
    style: context.textTheme.labelSmall?.copyWith(
      color: context.mobileTokens.muted,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.8,
    ),
  );
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final value = parts.take(2).map((part) => part.characters.first).join();
  return value.isEmpty ? '?' : value.toUpperCase();
}
