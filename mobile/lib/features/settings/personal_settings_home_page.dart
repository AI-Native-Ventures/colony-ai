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
    super.key,
  });

  final String displayName;
  final String? email;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final initials = _initials(displayName);
    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(
        title: 'Settings',
        backLabel: 'Close settings',
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.thirty,
          Grid.gutter,
          Grid.lg,
        ),
        children: [
          Row(
            children: [
              AvatarImage(
                imageUrl: avatarUrl,
                radius: 24,
                backgroundColor: const Color(0xFFEAE3ED),
                borderRadius: BorderRadius.circular(14.4),
                fallback: Text(
                  initials,
                  style: const TextStyle(
                    color: Color(0xFF786980),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: Grid.xs),
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
          const SizedBox(height: Grid.md),
          const _SettingsSectionLabel('YOU'),
          const SizedBox(height: Grid.xxs),
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
          const SizedBox(height: Grid.md),
          const _SettingsSectionLabel('THIS DEVICE'),
          const SizedBox(height: Grid.xxs),
          _PersonalSettingsRow(
            icon: LucideIcons.smartphone,
            title: 'App & devices',
            subtitle: 'Manage this phone and signed-in devices',
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsDevices,
                  const NoMobileRouteArguments(),
                ),
          ),
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

class _PersonalSettingsRow extends StatelessWidget {
  const _PersonalSettingsRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onPressed,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onPressed;

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
            constraints: const BoxConstraints(minHeight: 69),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: context.mobileTokens.line),
              ),
            ),
            padding: const EdgeInsets.symmetric(vertical: Grid.xs),
            child: Row(
              children: [
                SizedBox(
                  width: 40,
                  child: Icon(icon, size: 19, color: context.mobileTokens.ink),
                ),
                const SizedBox(width: Grid.xxs),
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
