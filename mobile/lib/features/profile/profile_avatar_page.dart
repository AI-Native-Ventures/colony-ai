import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_dashed_border.dart';
import 'profile_avatar_draft_provider.dart';
import 'profile_provider.dart';

/// Profile image options and entry points for photo, emoji, and animated avatars.
class ProfileAvatarPage extends HookConsumerWidget {
  const ProfileAvatarPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider);
    final profile = profileAsync.asData?.value;
    final removing = useState(false);
    final openingCameraSettings = useState(false);
    final colors = context.colors;

    Future<void> removePhoto() async {
      if (removing.value) return;
      removing.value = true;
      try {
        await ref.read(profileProvider.notifier).clearAvatar();
        ref.invalidate(profileAvatarDraftProvider);
        if (context.mounted) {
          await MobileNavigation.push<NoMobileRouteArguments, Object?>(
            context,
            MobileRoutes.profileAvatarSaved,
            const NoMobileRouteArguments(),
          );
        }
      } catch (_) {
        if (context.mounted) {
          await MobileNavigation.push<NoMobileRouteArguments, Object?>(
            context,
            MobileRoutes.profileFailed,
            const NoMobileRouteArguments(),
          );
        }
      } finally {
        if (context.mounted) removing.value = false;
      }
    }

    Future<void> openCameraSettings() async {
      if (openingCameraSettings.value) return;
      openingCameraSettings.value = true;
      try {
        await const MethodChannel(
          'buzz/qr_scanner',
        ).invokeMethod<bool>('openCameraSettings');
      } on PlatformException {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Camera settings could not be opened.'),
            ),
          );
        }
      } on MissingPluginException {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Camera settings are unavailable on this device.'),
            ),
          );
        }
      } finally {
        if (context.mounted) openingCameraSettings.value = false;
      }
    }

    final initials = _profileInitials(profile);
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Profile image'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.lg,
        ),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: AvatarImage(
              imageUrl: profile?.avatarUrl,
              radius: 17,
              backgroundColor: colors.secondaryContainer,
              fallback: Text(initials, style: context.textTheme.labelMedium),
              isAgent: true,
            ),
          ),
          const SizedBox(height: 1),
          InkWell(
            key: const ValueKey('profile-avatar-choose-photo'),
            onTap: () => _push(context, MobileRoutes.profileImage),
            borderRadius: BorderRadius.circular(Radii.md),
            child: ProfileDashedBorder(
              color: colors.outlineVariant,
              child: Container(
                height: 153,
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(Radii.md),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(LucideIcons.image, size: 19),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      'Choose a photo',
                      style: context.mobileTypography.conversation.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: Grid.quarter),
                    Text(
                      'JPEG, PNG or WebP · Up to 5 MB',
                      style: context.textTheme.labelSmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      'Choose File   No file chosen',
                      style: context.textTheme.labelSmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: Grid.xs),
          SizedBox(
            height: 44,
            child: FilledButton.tonal(
              onPressed: openingCameraSettings.value
                  ? null
                  : openCameraSettings,
              child: const Text('Camera permission'),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const ValueKey('profile-avatar-remove'),
              onPressed: removing.value ? null : removePhoto,
              child: Text(
                removing.value ? 'Removing photo…' : 'Remove current photo',
                style: TextStyle(color: colors.primary),
              ),
            ),
          ),
          const SizedBox(height: Grid.sm),
          _AvatarRouteRow(
            title: 'Emoji & background',
            subtitle: 'Pick a mark and a colour',
            onPressed: () => _push(context, MobileRoutes.profileAvatarEmoji),
          ),
          _AvatarRouteRow(
            title: 'Animated avatar',
            subtitle: 'Record, review, then save',
            onPressed: () => _push(context, MobileRoutes.profileAvatarCapture),
          ),
        ],
      ),
    );
  }
}

class _AvatarRouteRow extends StatelessWidget {
  const _AvatarRouteRow({
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
            height: 70,
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
                      const SizedBox(height: Grid.quarter),
                      Text(
                        subtitle,
                        style: context.textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(LucideIcons.arrowRight, size: 16, color: colors.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _profileInitials(UserProfile? profile) {
  final name = profile?.displayName?.trim() ?? '';
  if (name.isEmpty) return '?';
  final parts = name.split(RegExp(r'\s+'));
  return parts.take(2).map((part) => part[0]).join().toUpperCase();
}

void _push(BuildContext context, MobileRoute<NoMobileRouteArguments> route) {
  MobileNavigation.push<NoMobileRouteArguments, Object?>(
    context,
    route,
    const NoMobileRouteArguments(),
  );
}
