import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_avatar_preview_stage.dart';
import 'profile_provider.dart';

enum ProfileAvatarState {
  invalid,
  cameraDenied,
  saving,
  saved,
  failed,
  avatarSaved,
}

/// Renders the frozen invalid, camera recovery, and avatar save states.
class ProfileAvatarStatePage extends HookConsumerWidget {
  const ProfileAvatarStatePage({
    required this.state,
    this.savedAvatarBuilder,
    super.key,
  });

  final ProfileAvatarState state;
  @visibleForTesting
  final Widget Function()? savedAvatarBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).asData?.value;
    final name = profile?.displayName?.trim() ?? '';
    final initials = name.isEmpty
        ? '?'
        : name
              .split(RegExp(r'\s+'))
              .take(2)
              .map((part) => part[0])
              .join()
              .toUpperCase();
    return switch (state) {
      ProfileAvatarState.invalid => _invalid(
        context,
        profile?.avatarUrl,
        initials,
      ),
      ProfileAvatarState.cameraDenied => _cameraDenied(context),
      ProfileAvatarState.saving => _saving(
        context,
        profile?.avatarUrl,
        initials,
      ),
      ProfileAvatarState.saved => _saved(context, profile?.avatarUrl, initials),
      ProfileAvatarState.failed => _failed(
        context,
        profile?.avatarUrl,
        initials,
      ),
      ProfileAvatarState.avatarSaved => _avatarSaved(context, ref),
    };
  }

  Widget _invalid(
    BuildContext context,
    String? imageUrl,
    String initials,
  ) => _MessagePage(
    appBarTitle: 'Choose another photo',
    messageTitle: 'This file cannot be used',
    message:
        'Choose a JPEG, PNG or WebP smaller than 5 MB. Your current avatar stays unchanged.',
    messageKind: _MessageKind.error,
    actionLabel: 'Choose photo',
    imageUrl: imageUrl,
    initials: initials,
    showPreview: false,
    onAction: () => _push(context, MobileRoutes.profileImage),
  );

  Widget _cameraDenied(BuildContext context) => _CameraDeniedPage(
    onChooseEmoji: () => _push(context, MobileRoutes.profileAvatarEmoji),
    onChoosePhoto: () => _push(context, MobileRoutes.profileImage),
  );

  Widget _saving(BuildContext context, String? imageUrl, String initials) =>
      _MessagePage(
        appBarTitle: 'Profile image',
        messageTitle: 'Saving your avatar…',
        message:
            'Your current profile remains visible until the upload completes.',
        messageKind: _MessageKind.info,
        actionLabel: 'Save avatar',
        imageUrl: imageUrl,
        initials: initials,
        onAction: () => _push(context, MobileRoutes.profileImage),
      );

  Widget _saved(BuildContext context, String? imageUrl, String initials) =>
      _MessagePage(
        appBarTitle: 'Profile image',
        messageTitle: 'Avatar updated',
        message: 'Your new image is now used in this preview.',
        messageKind: _MessageKind.success,
        actionLabel: 'Done',
        imageUrl: imageUrl,
        initials: initials,
        onAction: () => Navigator.of(context).popUntil(
          (route) => route.settings.name == MobileRoutes.settingsProfile.path,
        ),
      );

  Widget _failed(BuildContext context, String? imageUrl, String initials) =>
      _MessagePage(
        appBarTitle: 'Profile image',
        messageTitle: 'Your avatar wasn’t saved',
        message: 'Your selection is kept. Retry when you’re connected.',
        messageKind: _MessageKind.error,
        actionLabel: 'Save avatar',
        imageUrl: imageUrl,
        initials: initials,
        onAction: () => Navigator.of(context).pop(),
      );

  Widget _avatarSaved(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider).asData?.value;
    final name = profile?.displayName?.trim() ?? '';
    final initials = name.isEmpty
        ? '?'
        : name
              .split(RegExp(r'\s+'))
              .take(2)
              .map((part) => part[0])
              .join()
              .toUpperCase();
    return Scaffold(
      backgroundColor: context.colors.surface,
      appBar: const MobileFlowAppBar(title: 'Profile image'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.gutter,
              Grid.gutter,
              Grid.thirty + Grid.twelve,
            ),
            child: Text(
              'Your avatar is updated',
              style: context.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Center(
            child:
                savedAvatarBuilder?.call() ??
                AvatarImage(
                  imageUrl: profile?.avatarUrl,
                  radius: 54,
                  backgroundColor: context.colors.secondaryContainer,
                  fallback: Text(initials),
                ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.lg + Grid.half,
              Grid.gutter,
              Grid.gutter,
            ),
            child: Text(
              'Your previous avatar is replaced only after you save.',
              style: context.textTheme.labelSmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton.tonal(
                onPressed: () => _push(context, MobileRoutes.profileAvatar),
                child: const Text('Edit avatar'),
              ),
            ),
          ),
          const Spacer(),
          SafeArea(
            top: false,
            child: _BottomButton(
              label: 'Done',
              onPressed: () => Navigator.of(context).popUntil(
                (route) =>
                    route.settings.name == MobileRoutes.settingsProfile.path,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CameraDeniedPage extends StatelessWidget {
  const _CameraDeniedPage({
    required this.onChooseEmoji,
    required this.onChoosePhoto,
  });

  final VoidCallback onChooseEmoji;
  final VoidCallback onChoosePhoto;

  static const _cameraSettingsChannel = MethodChannel('buzz/qr_scanner');

  Future<void> _openCameraSettings(BuildContext context) async {
    try {
      await _cameraSettingsChannel.invokeMethod<bool>('openCameraSettings');
    } on PlatformException {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Camera settings could not be opened.')),
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
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Camera access'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.scrollInset,
                Grid.gutter,
                Grid.gutter,
              ),
              children: [
                Text(
                  'Camera access is off.',
                  style: context.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  'Allow camera access in your phone’s settings to record an avatar.',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: Grid.twentyEight),
                SizedBox(
                  height: 150,
                  child: Center(child: Icon(LucideIcons.image, size: 38)),
                ),
                const SizedBox(height: Grid.twentyEight),
                _RecoveryButton(
                  label: 'Use an emoji instead',
                  onPressed: onChooseEmoji,
                ),
                const SizedBox(height: Grid.xxs),
                _RecoveryButton(
                  label: 'Choose a photo',
                  onPressed: onChoosePhoto,
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.xs,
                Grid.gutter,
                Grid.xs,
                Grid.xxs,
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: () => _openCameraSettings(context),
                  child: const Text('Open camera settings'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum _MessageKind { info, error, success }

class _MessagePage extends StatelessWidget {
  const _MessagePage({
    required this.appBarTitle,
    required this.messageTitle,
    required this.message,
    required this.messageKind,
    required this.actionLabel,
    required this.imageUrl,
    required this.initials,
    required this.onAction,
    this.showPreview = true,
  });

  final String appBarTitle;
  final String messageTitle;
  final String message;
  final _MessageKind messageKind;
  final String actionLabel;
  final String? imageUrl;
  final String initials;
  final VoidCallback onAction;
  final bool showPreview;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final color = switch (messageKind) {
      _MessageKind.info => colors.secondaryContainer,
      _MessageKind.error => colors.errorContainer,
      _MessageKind.success => colors.tertiaryContainer,
    };
    final foreground = switch (messageKind) {
      _MessageKind.info => colors.onSecondaryContainer,
      _MessageKind.error => colors.onErrorContainer,
      _MessageKind.success => colors.onTertiaryContainer,
    };
    final messageColor = messageKind == _MessageKind.error
        ? Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFF492F3B)
              : const Color(0xFFF9EAF0)
        : color;
    final messageForeground = messageKind == _MessageKind.error
        ? Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFFE5B6C5)
              : const Color(0xFF9B586B)
        : foreground;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: MobileFlowAppBar(title: appBarTitle),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                Grid.gutter,
                showPreview ? Grid.scrollInset : 29,
                Grid.gutter,
                Grid.gutter,
              ),
              children: [
                if (showPreview) ...[
                  ProfileAvatarPreviewStage(
                    initials: initials,
                    imageUrl: imageUrl,
                  ),
                  const SizedBox(height: Grid.gutter),
                ],
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(
                    Grid.fourteen,
                    Grid.fifteen,
                    Grid.fourteen,
                    Grid.fourteen + Grid.quarter,
                  ),
                  decoration: BoxDecoration(
                    color: messageColor,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        messageTitle,
                        style: context.textTheme.labelMedium?.copyWith(
                          fontSize: 12,
                          color: messageForeground,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        message,
                        style: context.textTheme.bodySmall?.copyWith(
                          fontSize: 12,
                          height: 1.6,
                          color: messageForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: _BottomButton(label: actionLabel, onPressed: onAction),
          ),
        ],
      ),
    );
  }
}

class _BottomButton extends StatelessWidget {
  const _BottomButton({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(Grid.xs, Grid.gutter, Grid.xs, Grid.xxs),
    decoration: BoxDecoration(
      border: Border(top: BorderSide(color: context.colors.outlineVariant)),
    ),
    child: SizedBox(
      width: double.infinity,
      height: 44,
      child: FilledButton(
        style: mobileFlowActionButtonStyle(context),
        onPressed: onPressed,
        child: Text(label),
      ),
    ),
  );
}

class _RecoveryButton extends StatelessWidget {
  const _RecoveryButton({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 44,
    child: FilledButton.tonal(onPressed: onPressed, child: Text(label)),
  );
}

void _push(BuildContext context, MobileRoute<NoMobileRouteArguments> route) {
  MobileNavigation.push<NoMobileRouteArguments, Object?>(
    context,
    route,
    const NoMobileRouteArguments(),
  );
}
