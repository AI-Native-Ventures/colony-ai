import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/push/push_bridge.dart';
import '../../shared/relay/relay_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Edits the community push setting supported by the current mobile API.
class SettingsNotificationsPage extends ConsumerWidget {
  const SettingsNotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final communityState = ref.watch(activeCommunityProvider);
    final community = communityState.asData?.value;
    final canManagePush = Env.pushGatewayConfigured;
    final colors = context.colors;

    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Notifications'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          if (communityState.isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: Grid.lg),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (communityState.hasError || community == null)
            Text(
              'Notification settings are unavailable until a community is connected.',
              style: bodyExtraSmallTextStyle.copyWith(
                color: colors.onSurfaceVariant,
              ),
            )
          else
            _PushNotificationSetting(
              enabled: community.pushNotificationsEnabled,
              available: canManagePush,
              onChanged: (value) => unawaited(
                ref
                    .read(communityListProvider.notifier)
                    .setPushNotificationsEnabled(community.id, value),
              ),
            ),
          if (community != null) ...[
            const SizedBox(height: Grid.xxs),
            _NotificationSettingsLink(
              title: 'Phone permission',
              subtitle: 'Review push permission',
              onPressed: () => unawaited(
                ref.read(buzzPushNotificationSettingsOpenerProvider)(),
              ),
            ),
            _NotificationSettingsLink(
              title: 'Preview privacy',
              subtitle: 'Hide content when locked',
              onPressed: () =>
                  MobileNavigation.push<NoMobileRouteArguments, Object?>(
                    context,
                    MobileRoutes.settingsPrivacy,
                    const NoMobileRouteArguments(),
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NotificationSettingsLink extends StatelessWidget {
  const _NotificationSettingsLink({
    required this.title,
    required this.subtitle,
    required this.onPressed,
  });

  final String title;
  final String subtitle;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Semantics(
      button: true,
      label: title,
      onTap: onPressed,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onPressed,
          child: Container(
            constraints: const BoxConstraints(minHeight: 68),
            padding: const EdgeInsets.symmetric(vertical: Grid.xs),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: colors.outlineVariant)),
            ),
            child: Row(
              children: [
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
                      Text(
                        subtitle,
                        style: bodyExtraSmallTextStyle.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, color: colors.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PushNotificationSetting extends StatelessWidget {
  const _PushNotificationSetting({
    required this.enabled,
    required this.available,
    required this.onChanged,
  });

  final bool enabled;
  final bool available;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      constraints: const BoxConstraints(minHeight: 72),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
      ),
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Push notifications',
                  style: context.mobileTypography.conversation.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.quarter),
                Text(
                  available
                      ? enabled
                            ? 'On for this community'
                            : 'Off for this community'
                      : 'Unavailable in this build',
                  style: bodyExtraSmallTextStyle.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: enabled,
            onChanged: available ? onChanged : null,
          ),
        ],
      ),
    );
  }
}
