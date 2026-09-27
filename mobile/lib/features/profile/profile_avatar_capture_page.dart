import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'animated_avatar_capture.dart';
import 'profile_avatar_draft.dart';
import 'profile_avatar_draft_provider.dart';

const _captureLightSurface = Color(0xFFFFFEFD);
const _captureDarkSurface = Color(0xFF25222C);
const _captureLightInk = Color(0xFF292632);
const _captureDarkInk = Color(0xFFEEE8F0);
const _captureLightMuted = Color(0xFF8B8590);
const _captureDarkMuted = Color(0xFFAAA1B1);
const _captureLightLine = Color(0xFFEEEBEE);
const _captureDarkLine = Color(0xFF3A3342);
const _captureLightLink = Color(0xFF345C99);
const _captureDarkLink = Color(0xFFA1BCE9);

/// Real camera capture entry for an animated profile avatar.
class ProfileAvatarCapturePage extends HookConsumerWidget {
  const ProfileAvatarCapturePage({this.cameraPreviewBuilder, super.key});

  /// Overrides the native camera surface for deterministic visual tests.
  final WidgetBuilder? cameraPreviewBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final openingRecovery = useState(false);
    final openingReview = useState(false);
    final inheritedTheme = Theme.of(context);
    final isDark = inheritedTheme.brightness == Brightness.dark;
    final surface = isDark ? _captureDarkSurface : _captureLightSurface;
    final ink = isDark ? _captureDarkInk : _captureLightInk;
    final muted = isDark ? _captureDarkMuted : _captureLightMuted;
    final line = isDark ? _captureDarkLine : _captureLightLine;
    final link = isDark ? _captureDarkLink : _captureLightLink;
    final scheme = inheritedTheme.colorScheme.copyWith(
      surface: surface,
      onSurface: ink,
      onSurfaceVariant: muted,
      primary: link,
      outline: line,
      outlineVariant: line,
    );
    return Theme(
      data: inheritedTheme.copyWith(
        colorScheme: scheme,
        scaffoldBackgroundColor: surface,
        appBarTheme: inheritedTheme.appBarTheme.copyWith(
          backgroundColor: surface,
          foregroundColor: ink,
          titleTextStyle: inheritedTheme.textTheme.titleMedium?.copyWith(
            color: ink,
          ),
          iconTheme: IconThemeData(color: ink),
        ),
      ),
      child: Builder(
        builder: (context) => Scaffold(
          backgroundColor: surface,
          appBar: const MobileFlowAppBar(title: 'Animated avatar'),
          body: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Grid.gutter,
                  Grid.sm,
                  Grid.gutter,
                  0,
                ),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Make it move.',
                        style: context.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'Keep yourself inside the circle.',
                        style: context.textTheme.bodySmall?.copyWith(
                          color: muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    void onCameraUnavailable() {
                      if (openingRecovery.value || !context.mounted) return;
                      openingRecovery.value = true;
                      _push(
                        context,
                        MobileRoutes.profileAvatarCameraDenied,
                      ).whenComplete(() {
                        if (context.mounted) openingRecovery.value = false;
                      });
                    }

                    void onPrepareChanged(
                      Future<ProfileAvatarDraft?> Function()? next,
                    ) {
                      if (next == null || openingReview.value) return;
                      openingReview.value = true;
                      unawaited(() async {
                        try {
                          final draft = await next();
                          if (draft == null || !context.mounted) return;
                          ref
                              .read(profileAvatarDraftProvider.notifier)
                              .setDraft(draft);
                          await _push(
                            context,
                            MobileRoutes.profileAvatarReview,
                          );
                        } catch (_) {
                          if (context.mounted) {
                            await _push(context, MobileRoutes.profileFailed);
                          }
                        } finally {
                          if (context.mounted) openingReview.value = false;
                        }
                      }());
                    }

                    return AnimatedAvatarCapture(
                      height: constraints.maxHeight,
                      onPrepareChanged: onPrepareChanged,
                      onCameraUnavailable: onCameraUnavailable,
                      compactPresentation: true,
                      cameraPreviewBuilder: cameraPreviewBuilder,
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> _push(
  BuildContext context,
  MobileRoute<NoMobileRouteArguments> route,
) => MobileNavigation.push<NoMobileRouteArguments, Object?>(
  context,
  route,
  const NoMobileRouteArguments(),
);
