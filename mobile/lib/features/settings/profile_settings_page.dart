import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Edits the current user's profile using callbacks composed in `app.dart`.
class ProfileSettingsPage extends HookConsumerWidget {
  const ProfileSettingsPage({
    required this.displayName,
    required this.avatarUrl,
    required this.email,
    required this.statusLabel,
    required this.onSaveDisplayName,
    super.key,
  });

  final String displayName;
  final String? avatarUrl;
  final String? email;
  final String statusLabel;
  final Future<void> Function(String displayName) onSaveDisplayName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final savedPrefs = ref.watch(savedPrefsProvider);
    final restoredName =
        savedPrefs.getString(_profileNameDraftKey) ?? displayName;
    final controller = useTextEditingController(text: restoredName);
    final saving = useState(false);
    final name = useState(restoredName);

    Future<void> save() async {
      if (saving.value) return;
      saving.value = true;
      try {
        if (!await savedPrefs.setString(
          _profileNameDraftKey,
          name.value.trim(),
        )) {
          throw StateError('Could not keep the profile edit for retry.');
        }
        try {
          await onSaveDisplayName(name.value.trim());
        } catch (_) {
          if (!context.mounted) return;
          await MobileNavigation.push<NoMobileRouteArguments, Object?>(
            context,
            MobileRoutes.settingsSaveFailed,
            const NoMobileRouteArguments(),
          );
          return;
        }
        await savedPrefs.remove(_profileNameDraftKey);
        if (context.mounted) FocusScope.of(context).unfocus();
      } finally {
        saving.value = false;
      }
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Profile'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twentyEight,
                Grid.gutter,
                Grid.md,
              ),
              children: [
                Row(
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: Grid.xxs),
                      child: AvatarImage(
                        imageUrl: avatarUrl,
                        radius: 17,
                        backgroundColor: const Color(0xFFEAE3ED),
                        borderRadius: BorderRadius.circular(10.2),
                        fallback: Text(
                          _initials(displayName),
                          style: const TextStyle(
                            color: Color(0xFF786980),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
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
                            style: context.textTheme.titleLarge?.copyWith(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: Grid.twelve),
                          TextButton(
                            style: TextButton.styleFrom(
                              alignment: Alignment.centerLeft,
                              foregroundColor: context.mobileTokens.action,
                              minimumSize: Size.zero,
                              padding: EdgeInsets.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              textStyle: context.mobileTypography.metadata
                                  .copyWith(fontSize: 12),
                            ),
                            onPressed: () =>
                                MobileNavigation.push<
                                  NoMobileRouteArguments,
                                  Object?
                                >(
                                  context,
                                  MobileRoutes.profileAvatar,
                                  const NoMobileRouteArguments(),
                                ),
                            child: const Text('Edit avatar'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Grid.sm),
                Text(
                  'Display name',
                  style: bodyExtraSmallTextStyle.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.xs),
                SizedBox(
                  height: 46,
                  child: TextField(
                    controller: controller,
                    onChanged: (value) => name.value = value,
                    textCapitalization: TextCapitalization.words,
                    style: context.mobileTypography.conversation.copyWith(
                      fontSize: 13,
                    ),
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      isDense: false,
                      constraints: BoxConstraints(minHeight: 46),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: Grid.twelve,
                        vertical: Grid.twelve,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: Grid.twelve),
                if (email != null) ...[
                  _ProfileValueRow(label: 'Email', value: email!),
                  const SizedBox(height: Grid.twelve),
                ],
                _ProfileActionRow(
                  title: 'Password reset',
                  subtitle: 'Reset by email',
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.accountForgot,
                        const NoMobileRouteArguments(),
                      ),
                ),
                _ProfileActionRow(
                  title: 'Active sessions',
                  subtitle: 'Manage your signed-in devices',
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsDevices,
                        const NoMobileRouteArguments(),
                      ),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    alignment: Alignment.centerLeft,
                    minimumSize: const Size(0, 42),
                    padding: EdgeInsets.zero,
                    foregroundColor: context.mobileTokens.action,
                    textStyle: context.mobileTypography.metadata.copyWith(
                      fontSize: 12,
                    ),
                  ),
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsSaveFailed,
                        const NoMobileRouteArguments(),
                      ),
                  child: const Text('Preview save error'),
                ),
                _ProfileActionRow(
                  title: 'Status',
                  subtitle: statusLabel,
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.profileStatus,
                        const NoMobileRouteArguments(),
                      ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(
                Grid.xs,
                Grid.gutter,
                Grid.xs,
                Grid.xxs,
              ),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: context.mobileTokens.line),
                ),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: saving.value ? null : save,
                  child: const Text('Save profile'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileValueRow extends StatelessWidget {
  const _ProfileValueRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 50),
      padding: const EdgeInsets.symmetric(vertical: Grid.xs),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 124,
            child: Text(
              label,
              style: bodyExtraSmallTextStyle.copyWith(
                color: context.mobileTokens.muted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: context.mobileTypography.conversation.copyWith(
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileActionRow extends StatelessWidget {
  const _ProfileActionRow({
    required this.title,
    required this.subtitle,
    required this.onPressed,
  });

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
            constraints: const BoxConstraints(minHeight: 68),
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: context.mobileTokens.line),
              ),
            ),
            padding: const EdgeInsets.symmetric(vertical: Grid.xs),
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

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final value = parts.take(2).map((part) => part.characters.first).join();
  return value.isEmpty ? '?' : value.toUpperCase();
}

const _profileNameDraftKey = 'buzz-profile-settings-name-draft.v1';
