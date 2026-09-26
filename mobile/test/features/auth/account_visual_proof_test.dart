import 'dart:io';

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:buzz/features/auth/account_auth_provider.dart';
import 'package:buzz/features/auth/account_auth_types.dart';
import 'package:buzz/features/auth/account_flow_result_page.dart';
import 'package:buzz/features/auth/auth_entry_page.dart';
import 'package:buzz/features/auth/confirm_password_reset_page.dart';
import 'package:buzz/features/auth/create_account_page.dart';
import 'package:buzz/features/auth/request_password_reset_page.dart';
import 'package:buzz/features/auth/sign_in_page.dart';
import 'package:buzz/features/auth/verify_code_page.dart';
import 'package:buzz/shared/theme/theme.dart';

void main() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_W23_ACCOUNT_SHOTS');
  final output = Directory('/tmp/w23-mobile-auth-proof')
    ..createSync(recursive: true);

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _screenCases) {
        testWidgets(
          'captures ${screen.name} ${brightness.name} ${size.width.toInt()}x'
          '${size.height.toInt()}',
          (tester) async {
            debugDefaultTargetPlatformOverride = TargetPlatform.android;
            final previousComparator = goldenFileComparator;
            if (captureScreenshots) {
              goldenFileComparator = LocalFileComparator(
                Uri.file('${output.path}/golden_test.dart'),
              );
              tester.view.viewPadding = const FakeViewPadding(
                top: 46,
                bottom: 20,
              );
              tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
            }
            addTearDown(() {
              tester.view.resetPhysicalSize();
              tester.view.resetDevicePixelRatio();
              tester.view.viewPadding = FakeViewPadding.zero;
              tester.view.padding = FakeViewPadding.zero;
              goldenFileComparator = previousComparator;
            });
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = size;

            if (captureScreenshots) await _loadProofFonts();

            final rootKey = GlobalKey();
            final app = MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(),
              darkTheme: AppTheme.dark(),
              themeMode: brightness == Brightness.dark
                  ? ThemeMode.dark
                  : ThemeMode.light,
              home: screen.build(),
            );
            await tester.pumpWidget(
              ProviderScope(
                overrides: [
                  accountAuthProvider.overrideWith(_VisualProofAccountAuth.new),
                ],
                child: RepaintBoundary(
                  key: rootKey,
                  child: captureScreenshots
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(36),
                          child: Directionality(
                            textDirection: TextDirection.ltr,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                app,
                                _ProofStatusBar(brightness: brightness),
                                _ProofHomeIndicator(brightness: brightness),
                              ],
                            ),
                          ),
                        )
                      : app,
                ),
              ),
            );
            await tester.pump(const Duration(milliseconds: 400));
            await _seedReferenceFields(tester, screen.name);

            if (screen.name == 'verify-code' || screen.name == 'reset-code') {
              expect(tester.getSize(find.byType(TextField).first).height, 52);
              expect(
                tester.getSize(find.byType(InputDecorator).first).height,
                52,
              );
            }

            if (captureScreenshots) {
              final filename =
                  '${screen.name}-${brightness.name}-'
                  '${size.width.toInt()}x${size.height.toInt()}.png';
              await expectLater(
                find.byKey(rootKey),
                matchesGoldenFile(filename),
              );
              // These are test-only reference fixtures. Production forms
              // remain empty when a user starts an account flow.
              debugPrint('VISUAL_PROOF ${output.path}/$filename');
            } else {
              expect(find.byKey(rootKey), findsOneWidget);
            }
            debugDefaultTargetPlatformOverride = null;
          },
        );
      }
    }
  }
}

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final icons = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await icons.load();
}

final _screenCases = <_ScreenCase>[
  _ScreenCase(
    'welcome',
    () => AuthEntryPage(
      advancedIdentityPageBuilder: (_) => const SizedBox.shrink(),
    ),
  ),
  _ScreenCase(
    'sign-in',
    () => SignInPage(pairIdentityPageBuilder: (_) => const SizedBox.shrink()),
  ),
  _ScreenCase('sign-up', () => const CreateAccountPage()),
  _ScreenCase('reset-request', () => const RequestPasswordResetPage()),
  _ScreenCase(
    'verify-code',
    () => const VerifyCodePage(email: 'lerato@example.com'),
  ),
  _ScreenCase(
    'reset-code',
    () => const VerifyCodePage(
      email: 'lerato@example.com',
      purpose: AccountCodePurpose.reset,
    ),
  ),
  _ScreenCase(
    'new-password',
    () => const ConfirmPasswordResetPage(email: 'lerato@example.com'),
  ),
  _ScreenCase(
    'verify-done',
    () =>
        const AccountFlowResultPage(kind: AccountFlowResultKind.emailVerified),
  ),
  _ScreenCase(
    'reset-done',
    () => const AccountFlowResultPage(
      kind: AccountFlowResultKind.passwordUpdated,
    ),
  ),
];

Future<void> _seedReferenceFields(
  WidgetTester tester,
  String screenName,
) async {
  if (screenName == 'sign-in') {
    await tester.enterText(
      find.byType(TextFormField).first,
      'lerato@example.com',
    );
  } else if (screenName == 'sign-up') {
    await tester.enterText(find.byType(TextFormField).at(0), 'Lerato Molefe');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'lerato@example.com',
    );
  } else if (screenName == 'reset-request') {
    await tester.enterText(find.byType(TextFormField), 'lerato@example.com');
  }
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
}

class _ScreenCase {
  const _ScreenCase(this.name, this.build);

  final String name;
  final Widget Function() build;
}

class _VisualProofAccountAuth extends AccountAuthNotifier {
  @override
  AccountAuthState build() => const AccountAuthState();
}

class _ProofStatusBar extends StatelessWidget {
  const _ProofStatusBar({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = Color(
      brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
    );
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: SizedBox(
          height: 46,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(25, 8, 25, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '9:41',
                  style: TextStyle(
                    color: color,
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Icon(Icons.signal_cellular_alt, color: color, size: 14),
                    const SizedBox(width: 3),
                    Icon(Icons.battery_full, color: color, size: 16),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProofHomeIndicator extends StatelessWidget {
  const _ProofHomeIndicator({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) => Positioned(
    bottom: 8,
    left: 0,
    right: 0,
    child: IgnorePointer(
      child: Align(
        alignment: Alignment.center,
        child: Container(
          width: 108,
          height: 4,
          decoration: BoxDecoration(
            color: Color(
              brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
            ),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      ),
    ),
  );
}
