import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_dashed_border.dart';
import 'profile_avatar_draft.dart';
import 'profile_avatar_draft_provider.dart';
import 'profile_avatar_preview_stage.dart';
import 'profile_provider.dart';

const _maxAvatarBytes = 5 * 1024 * 1024;
const _allowedAvatarTypes = {'image/jpeg', 'image/png', 'image/webp'};

/// Selects, crops, and saves a still profile avatar using the existing upload.
class ProfileImagePage extends HookConsumerWidget {
  const ProfileImagePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final profile = ref.watch(profileProvider).asData?.value;
    final draft = ref.watch(profileAvatarDraftProvider);
    final saving = useState(false);
    final error = useState<String?>(null);
    final service = ref.read(mediaUploadServiceProvider);

    Future<void> chooseImage() async {
      error.value = null;
      try {
        final picked = await service.pickGalleryImage();
        if (picked == null || !context.mounted) return;
        final mimeType = _mimeType(picked.mimeType, picked.name);
        if (!_allowedAvatarTypes.contains(mimeType) ||
            await picked.length() > _maxAvatarBytes) {
          if (context.mounted) _openRoute(context, MobileRoutes.profileInvalid);
          return;
        }
        final bytes = await service.prepareImageBytes(picked);
        if (!context.mounted) return;
        final cropped = await MobileNavigation.push<Uint8List, Uint8List>(
          context,
          MobileRoutes.profileCrop,
          bytes,
        );
        if (cropped == null || !context.mounted) return;
        ref
            .read(profileAvatarDraftProvider.notifier)
            .setDraft(ProfileImageAvatarDraft(cropped));
      } catch (_) {
        if (context.mounted) {
          error.value = "We couldn't prepare that photo. Try again.";
        }
      }
    }

    Future<void> saveAvatar() async {
      if (saving.value) return;
      final currentDraft = ref.read(profileAvatarDraftProvider);
      if (currentDraft == null) {
        await chooseImage();
        return;
      }
      saving.value = true;
      error.value = null;
      try {
        final url = await currentDraft.upload(service);
        await ref.read(profileProvider.notifier).updateAvatarUrl(url);
        ref.read(profileAvatarDraftProvider.notifier).clear();
        if (context.mounted) _openRoute(context, MobileRoutes.profileSaved);
      } catch (_) {
        if (context.mounted) _openRoute(context, MobileRoutes.profileFailed);
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    final initials = _initials(profile);
    final stagedAvatar = switch (draft) {
      ProfileImageAvatarDraft(:final bytes) => Center(
        child: ClipOval(
          child: Image.memory(
            bytes,
            width: 130,
            height: 130,
            fit: BoxFit.cover,
            gaplessPlayback: true,
          ),
        ),
      ),
      ProfileUrlAvatarDraft(:final url) => Center(
        child: AvatarImage(
          imageUrl: url,
          radius: 65,
          backgroundColor: const Color(0xFFE8E2EC),
          fallback: Text(initials),
        ),
      ),
      _ => null,
    };

    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Profile image'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.scrollInset,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                ProfileAvatarPreviewStage(
                  initials: initials,
                  imageUrl: profile?.avatarUrl,
                  avatar: stagedAvatar,
                ),
                const SizedBox(height: Grid.gutter),
                InkWell(
                  onTap: saving.value ? null : chooseImage,
                  borderRadius: BorderRadius.circular(Radii.md),
                  child: ProfileDashedBorder(
                    color: colors.outlineVariant,
                    child: Container(
                      height: 153,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(Radii.md),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(LucideIcons.image, size: 19),
                          const SizedBox(height: Grid.xxs),
                          Text(
                            draft == null
                                ? 'Select an image'
                                : 'Choose another image',
                            style: context.mobileTypography.conversation
                                .copyWith(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: Grid.quarter),
                          Text(
                            'JPEG, PNG or WebP · Preview only',
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
                if (error.value != null) ...[
                  const SizedBox(height: Grid.xs),
                  Text(
                    error.value!,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: colors.error,
                    ),
                  ),
                ],
                if (saving.value) ...[
                  const SizedBox(height: Grid.xs),
                  _AvatarInfoCard(
                    title: 'Saving your avatar…',
                    detail:
                        'Your current profile remains visible until the upload completes.',
                    color: colors.secondaryContainer,
                    textColor: colors.onSecondaryContainer,
                  ),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: _AvatarBottomAction(
              label: saving.value ? 'Saving your avatar…' : 'Save avatar',
              onPressed: saving.value ? null : saveAvatar,
            ),
          ),
        ],
      ),
    );
  }
}

class _AvatarBottomAction extends StatelessWidget {
  const _AvatarBottomAction({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(Grid.xs, Grid.gutter, Grid.xs, Grid.xxs),
    decoration: BoxDecoration(
      border: Border(top: BorderSide(color: context.colors.outlineVariant)),
    ),
    child: SizedBox(
      height: 44,
      width: double.infinity,
      child: FilledButton(
        style: mobileFlowActionButtonStyle(context),
        onPressed: onPressed,
        child: Text(label),
      ),
    ),
  );
}

class _AvatarInfoCard extends StatelessWidget {
  const _AvatarInfoCard({
    required this.title,
    required this.detail,
    required this.color,
    required this.textColor,
  });

  final String title;
  final String detail;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(Grid.xs),
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(Radii.sm),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: context.textTheme.labelMedium?.copyWith(
            color: textColor,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: Grid.xxs),
        Text(
          detail,
          style: context.textTheme.labelSmall?.copyWith(color: textColor),
        ),
      ],
    ),
  );
}

String _mimeType(String? mime, String name) {
  if (mime != null && mime.isNotEmpty) return mime.toLowerCase();
  final extension = name.split('.').last.toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    _ => '',
  };
}

String _initials(UserProfile? profile) {
  final name = profile?.displayName?.trim() ?? '';
  if (name.isEmpty) return '?';
  return name
      .split(RegExp(r'\s+'))
      .take(2)
      .map((part) => part[0])
      .join()
      .toUpperCase();
}

void _openRoute(
  BuildContext context,
  MobileRoute<NoMobileRouteArguments> route,
) {
  MobileNavigation.push<NoMobileRouteArguments, Object?>(
    context,
    route,
    const NoMobileRouteArguments(),
  );
}
