import 'dart:typed_data';

import 'package:buzz/features/profile/profile_avatar_crop_route_page.dart';
import 'package:buzz/features/profile/profile_avatar_capture_page.dart';
import 'package:buzz/features/profile/profile_avatar_emoji_page.dart';
import 'package:buzz/features/profile/profile_avatar_page.dart';
import 'package:buzz/features/profile/profile_avatar_preview_stage.dart';
import 'package:buzz/features/profile/profile_avatar_state_page.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  testWidgets('avatar choices open the real emoji editor route', (
    tester,
  ) async {
    final registry = MobileRouteRegistry.empty().register(
      MobileRoutes.profileAvatarEmoji,
      (context, _) => const ProfileAvatarEmojiPage(),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [profileProvider.overrideWith(_ProfileNotifier.new)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: MobileRouteScope(
            registry: registry,
            child: const ProfileAvatarPage(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Profile image'), findsOneWidget);
    expect(find.text('Choose a photo'), findsOneWidget);
    expect(find.text('Emoji & background'), findsOneWidget);
    expect(find.text('Animated avatar'), findsOneWidget);

    await tester.tap(find.text('Emoji & background'));
    await tester.pumpAndSettle();
    expect(find.text('A little more you.'), findsOneWidget);
    expect(find.text('Save avatar'), findsOneWidget);
    expect(find.text('🌿'), findsWidgets);
  });

  testWidgets('crop route explains an empty selection before saving', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: ProfileAvatarCropRoutePage(imageBytes: Uint8List(0)),
      ),
    );

    expect(find.text('Crop photo'), findsOneWidget);
    expect(find.text('Choose a photo first'), findsOneWidget);
    expect(
      find.text('The crop preview uses your selected file.'),
      findsOneWidget,
    );
    expect(find.text('Zoom'), findsOneWidget);
    expect(find.text('Horizontal position'), findsOneWidget);
    expect(find.text('Vertical position'), findsOneWidget);
  });

  testWidgets('invalid photo matches the designed message and recovery route', (
    tester,
  ) async {
    final registry = MobileRouteRegistry.empty().register(
      MobileRoutes.profileImage,
      (context, _) => const Scaffold(body: Text('Choose photo route opened')),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [profileProvider.overrideWith(_ProfileNotifier.new)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: MobileRouteScope(
            registry: registry,
            child: const ProfileAvatarStatePage(
              state: ProfileAvatarState.invalid,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Choose another photo'), findsOneWidget);
    expect(find.text('This file cannot be used'), findsOneWidget);
    expect(
      find.text(
        'Choose a JPEG, PNG or WebP smaller than 5 MB. Your current avatar stays unchanged.',
      ),
      findsOneWidget,
    );
    expect(find.byType(ProfileAvatarPreviewStage), findsNothing);
    expect(find.text('Choose photo'), findsOneWidget);

    await tester.tap(find.text('Choose photo'));
    await tester.pumpAndSettle();
    expect(find.text('Choose photo route opened'), findsOneWidget);
  });

  testWidgets('animated avatar exposes camera switch and recovery controls', (
    tester,
  ) async {
    final registry = MobileRouteRegistry.empty().register(
      MobileRoutes.profileAvatarCameraDenied,
      (context, _) => const Scaffold(body: Text('Camera recovery opened')),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [profileProvider.overrideWith(_ProfileNotifier.new)],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: MobileRouteScope(
            registry: registry,
            child: ProfileAvatarCapturePage(
              cameraPreviewBuilder: (_) => const ColoredBox(
                color: Colors.transparent,
                child: SizedBox.expand(),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Start recording'), findsOneWidget);
    expect(find.byTooltip('Switch camera'), findsOneWidget);
    expect(find.text('Access help'), findsOneWidget);
    await tester.tap(find.text('Access help'));
    await tester.pumpAndSettle();
    expect(find.text('Camera recovery opened'), findsOneWidget);
  });
}

class _ProfileNotifier extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async =>
      const UserProfile(pubkey: 'profile-test', displayName: 'Lerato Molefe');
}
