import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_avatar_draft.dart';
import 'profile_avatar_draft_provider.dart';
import 'profile_provider.dart';

/// Reviews a prepared animated avatar and publishes it after approval.
class ProfileAvatarReviewPage extends HookConsumerWidget {
  const ProfileAvatarReviewPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final draft = ref.watch(profileAvatarDraftProvider);
    final profile = ref.watch(profileProvider).asData?.value;
    final paused = useState(false);
    final saving = useState(false);
    final animation = draft is ProfileAnimatedAvatarDraft
        ? draft.animation
        : null;
    final initials = _initials(profile?.displayName);
    final colors = context.colors;

    Future<void> useAnimation() async {
      if (saving.value || draft is! ProfileAnimatedAvatarDraft) return;
      saving.value = true;
      try {
        final url = await draft.upload(ref.read(mediaUploadServiceProvider));
        await ref.read(profileProvider.notifier).updateAvatarUrl(url);
        ref.read(profileAvatarDraftProvider.notifier).clear();
        if (context.mounted) {
          await _push(context, MobileRoutes.profileAvatarSaved);
        }
      } catch (_) {
        if (context.mounted) await _push(context, MobileRoutes.profileFailed);
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Review your avatar'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.scrollInset,
              Grid.gutter,
              0,
            ),
            child: Text(
              'Happy with this take?',
              style: context.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: Grid.lg),
          Center(
            child: Container(
              width: 210,
              height: 210,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  colors: [Color(0xFFE8BDDD), Color(0xFFBAD5E4)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Center(
                child: animation == null
                    ? Text(
                        initials,
                        style: const TextStyle(
                          color: Color(0xFF363043),
                          fontSize: 56,
                          fontWeight: FontWeight.w400,
                        ),
                      )
                    : ClipOval(
                        child: Image.memory(animation, fit: BoxFit.cover),
                      ),
              ),
            ),
          ),
          const SizedBox(height: Grid.twentyEight),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
            child: Row(
              children: [
                Text(
                  '00:00',
                  style: context.textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(width: Grid.xxs),
                Expanded(
                  child: LinearProgressIndicator(
                    value: paused.value ? 0.42 : 0.33,
                    minHeight: 3,
                    borderRadius: BorderRadius.circular(Radii.full),
                    color: const Color(0xFFAB87BB),
                    backgroundColor: const Color(0xFFE6DFE9),
                  ),
                ),
                const SizedBox(width: Grid.xxs),
                Text(
                  '00:03',
                  style: context.textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: Grid.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton.tonal(
                onPressed: () => paused.value = !paused.value,
                child: Text(paused.value ? 'Play preview' : 'Pause preview'),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.xs,
              Grid.gutter,
              Grid.xxs,
            ),
            child: Text(
              '3-second sample loop · initials stand in for camera footage.',
              style: context.textTheme.labelSmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton.tonal(
                onPressed: saving.value
                    ? null
                    : () => Navigator.of(context).pop(),
                child: const Text('Retake'),
              ),
            ),
          ),
          const Spacer(),
          SafeArea(
            top: false,
            child: Container(
              margin: const EdgeInsets.only(top: Grid.xs),
              padding: const EdgeInsets.fromLTRB(
                Grid.xs,
                Grid.gutter,
                Grid.xs,
                Grid.xxs,
              ),
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: colors.outlineVariant)),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: saving.value ? null : useAnimation,
                  child: Text(
                    saving.value ? 'Saving avatar…' : 'Use this animation',
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _initials(String? name) {
  final value = name?.trim() ?? '';
  if (value.isEmpty) return '?';
  return value
      .split(RegExp(r'\s+'))
      .take(2)
      .map((part) => part[0])
      .join()
      .toUpperCase();
}

Future<void> _push(
  BuildContext context,
  MobileRoute<NoMobileRouteArguments> route,
) => MobileNavigation.push<NoMobileRouteArguments, Object?>(
  context,
  route,
  const NoMobileRouteArguments(),
);
