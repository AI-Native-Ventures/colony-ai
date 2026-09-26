import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:buzz/features/auth/account_action_button.dart';
import 'package:buzz/features/auth/account_auth_provider.dart';
import 'package:buzz/features/auth/account_auth_types.dart';
import 'package:buzz/features/auth/account_flow_palette.dart';
import 'package:buzz/features/auth/account_flow_result_page.dart';
import 'package:buzz/features/auth/auth_entry_page.dart';
import 'package:buzz/features/auth/claim_account_page.dart';
import 'package:buzz/features/auth/create_account_page.dart';
import 'package:buzz/features/auth/request_password_reset_page.dart';
import 'package:buzz/features/auth/sign_in_page.dart';
import 'package:buzz/features/auth/verify_code_page.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets('loading account action keeps an accessible label', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: const AccountActionButton(
          label: 'Continue',
          isLoading: true,
          onPressed: null,
        ),
      ),
    );

    expect(
      tester.getSemantics(find.bySemanticsLabel('Continue in progress')).label,
      'Continue in progress',
    );
    semantics.dispose();
  });

  testWidgets('entry presents the frozen Colony welcome and account choices', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final auth = _FakeAccountAuthNotifier();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(auth),
        child: AuthEntryPage(
          advancedIdentityPageBuilder: (_) =>
              const Scaffold(body: Text('Existing identity pairing')),
        ),
      ),
    );

    expect(find.text('Create an account'), findsOneWidget);
    expect(
      find.text('Good people.\nGreat agents.\nYour next chapter.'),
      findsOneWidget,
    );
    expect(find.text('I already have an account'), findsOneWidget);
    expect(find.text('Pair with my desktop'), findsOneWidget);
    expect(find.textContaining('private key'), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Create an account'),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Pair with my desktop'));
    await tester.pumpAndSettle();
    expect(find.text('Existing identity pairing'), findsOneWidget);
  });

  testWidgets('sign-in keeps the existing desktop pairing entry reachable', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(_FakeAccountAuthNotifier()),
        child: AuthEntryPage(
          advancedIdentityPageBuilder: (_) =>
              const Scaffold(body: Text('Existing identity pairing')),
        ),
      ),
    );

    await tester.tap(find.text('I already have an account'));
    await tester.pumpAndSettle();
    expect(find.text('Pair with my desktop'), findsOneWidget);
    final createAccountLabel = tester.getRect(
      find.text('New to Colony? Create an account'),
    );
    final pairDesktopLabel = tester.getRect(find.text('Pair with my desktop'));
    expect(pairDesktopLabel.top - createAccountLabel.bottom, greaterThan(55));
    await tester.tap(find.text('Pair with my desktop'));
    await tester.pumpAndSettle();
    expect(find.text('Existing identity pairing'), findsOneWidget);
  });

  testWidgets(
    'signup CTA is solid and explains why it is disabled until consent',
    (tester) async {
      _prepareMobileViewport(tester);
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        WidgetHelpers.testable(child: const CreateAccountPage()),
      );

      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Create account'),
      );
      expect(button.onPressed, isNull);
      expect(
        button.style?.backgroundColor?.resolve({WidgetState.disabled}),
        AccountFlowPalette.action.withValues(alpha: 0.45),
      );
      expect(
        button.style?.foregroundColor?.resolve({WidgetState.disabled}),
        Colors.white,
      );
      final buttonSemantics = tester.getSemantics(
        find.bySemanticsLabel('Create account'),
      );
      expect(buttonSemantics.flagsCollection.isButton, isTrue);
      expect(
        buttonSemantics.flagsCollection.isEnabled.toString(),
        'Tristate.isFalse',
      );
      expect(
        buttonSemantics.hint,
        'Agree to the Terms and Privacy Policy to create your account.',
      );
      semantics.dispose();
    },
  );

  testWidgets('signup validates locally and opens code verification', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final auth = _FakeAccountAuthNotifier();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(auth),
        child: const CreateAccountPage(),
      ),
    );

    await tester.enterText(find.byType(TextFormField).at(0), 'Lerato Molefe');
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'person@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(2), '');
    await tester.ensureVisible(find.byType(Checkbox));
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Create account'),
          )
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await _pumpFormResult(tester);
    expect(find.text('Enter a password.'), findsOneWidget);
    expect(auth.signUpCalls, 0);

    await tester.enterText(find.byType(TextFormField).at(2), 'password-1234');
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await _pumpFormResult(tester);
    expect(auth.signUpCalls, 1);
    expect(find.text('Check your email'), findsOneWidget);
    expect(find.textContaining('person@example.com'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);
  });

  testWidgets(
    'sign-in shows invalid credentials and handles unverified email',
    (tester) async {
      _prepareMobileViewport(tester);
      final auth = _FakeAccountAuthNotifier()
        ..signInResults.addAll([
          const AccountAuthState(
            status: AccountAuthStatus.failed,
            failure: AccountAuthFailure(
              AccountAuthFailureKind.invalidCredentials,
            ),
          ),
          const AccountAuthState(
            status: AccountAuthStatus.verificationSent,
            codePurpose: AccountCodePurpose.verify,
          ),
        ]);
      await tester.pumpWidget(
        WidgetHelpers.testable(
          overrides: _overrides(auth),
          child: SignInPage(
            pairIdentityPageBuilder: (_) => const SizedBox.shrink(),
          ),
        ),
      );

      await tester.enterText(
        find.byType(TextFormField).at(0),
        'person@example.com',
      );
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'wrong-password',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await _pumpFormResult(tester);
      expect(
        find.text('That email or password did not match.'),
        findsOneWidget,
      );

      await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
      await _pumpFormResult(tester);
      expect(find.text('Check your email'), findsOneWidget);
      expect(find.byType(TextField), findsNWidgets(6));
    },
  );

  testWidgets(
    'verification shows the API-backed code failure and resend confirmation',
    (tester) async {
      _prepareMobileViewport(tester);
      final auth = _FakeAccountAuthNotifier()
        ..verifyResult = const AccountAuthState(
          status: AccountAuthStatus.failed,
          failure: AccountAuthFailure(AccountAuthFailureKind.codeExpired),
        );
      await tester.pumpWidget(
        WidgetHelpers.testable(
          overrides: _overrides(auth),
          child: const VerifyCodePage(email: 'person@example.com'),
        ),
      );

      await tester.enterText(find.byType(TextField).first, '123456');
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue'))
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await _pumpFormResult(tester);
      expect(
        find.text(
          'This code can no longer be used. Request a new code and try again.',
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Resend code'));
      await _pumpFormResult(tester);
      expect(find.text('A new code has been sent.'), findsOneWidget);
      expect(auth.resendCalls, 1);
    },
  );

  testWidgets('code fields support arrows and backspace recovery', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(_FakeAccountAuthNotifier()),
        child: const VerifyCodePage(email: 'person@example.com'),
      ),
    );

    final fields = find.byType(TextField);
    await tester.tap(fields.first);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pump();
    expect(tester.widget<TextField>(fields.at(1)).focusNode!.hasFocus, isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pump();
    expect(tester.widget<TextField>(fields.first).focusNode!.hasFocus, isTrue);

    await tester.enterText(fields.first, '1');
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
    await tester.pump();
    expect(tester.widget<TextField>(fields.first).controller!.text, isEmpty);
    expect(tester.widget<TextField>(fields.first).focusNode!.hasFocus, isTrue);
  });

  testWidgets('verified account continues through the typed age route', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final registry = MobileRouteRegistry.empty().register(
      MobileRoutes.accountAge,
      (context, _) => const Scaffold(body: Text('Age setup fixture')),
    );
    await tester.pumpWidget(
      WidgetHelpers.testable(
        child: MobileRouteScope(
          registry: registry,
          child: const AccountFlowResultPage(
            kind: AccountFlowResultKind.emailVerified,
          ),
        ),
      ),
    );

    expect(find.text('Email verified'), findsOneWidget);
    expect(find.text('You’re ready to set up your business.'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Continue to setup'));
    await tester.pumpAndSettle();
    expect(find.text('Age setup fixture'), findsOneWidget);
  });

  testWidgets('forgot password stays generic and reset errors remain visible', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final auth = _FakeAccountAuthNotifier()
      ..resetResult = const AccountAuthState(
        status: AccountAuthStatus.failed,
        failure: AccountAuthFailure(AccountAuthFailureKind.weakPassword),
      );
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(auth),
        child: const RequestPasswordResetPage(),
      ),
    );

    await tester.enterText(find.byType(TextFormField), 'person@example.com');
    await tester.tap(find.widgetWithText(FilledButton, 'Send code'));
    await _pumpFormResult(tester);
    expect(find.text('Check your email'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '123456');
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue'))
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await _pumpFormResult(tester);
    expect(find.text('Choose a new password'), findsOneWidget);
    expect(find.text('Confirm new password'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).at(0), 'password-1234');
    await tester.enterText(find.byType(TextFormField).at(1), 'password-1234');
    await tester.tap(find.widgetWithText(FilledButton, 'Update password'));
    await _pumpFormResult(tester);
    expect(
      find.text('Use a password with at least 10 characters.'),
      findsOneWidget,
    );
  });

  testWidgets('claim form never asks the user to paste an identity secret', (
    tester,
  ) async {
    _prepareMobileViewport(tester);
    final auth = _FakeAccountAuthNotifier();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(auth),
        child: const ClaimAccountPage(),
      ),
    );

    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.textContaining('nsec'), findsNothing);
    expect(find.textContaining('private key'), findsNothing);
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'person@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'password-1234');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await _pumpFormResult(tester);
    expect(auth.claimCalls, 1);
    expect(find.text('Check your email'), findsOneWidget);
  });
}

List<Override> _overrides(_FakeAccountAuthNotifier auth) => [
  accountAuthProvider.overrideWith(() => auth),
];

void _prepareMobileViewport(WidgetTester tester) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(390, 844);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFormResult(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

class _FakeAccountAuthNotifier extends AccountAuthNotifier {
  final signInResults = <AccountAuthState>[];
  int signUpCalls = 0;
  int resendCalls = 0;
  int claimCalls = 0;
  AccountAuthState verifyResult = const AccountAuthState(
    status: AccountAuthStatus.complete,
  );
  AccountAuthState resetResult = const AccountAuthState(
    status: AccountAuthStatus.resetComplete,
  );

  @override
  AccountAuthState build() => const AccountAuthState();

  @override
  Future<void> signUp({required String email, required String password}) async {
    signUpCalls++;
    state = const AccountAuthState(
      status: AccountAuthStatus.verificationSent,
      codePurpose: AccountCodePurpose.verify,
    );
  }

  @override
  Future<void> signIn({required String email, required String password}) async {
    state = signInResults.removeAt(0);
  }

  @override
  Future<void> verifyCode({required String email, required String code}) async {
    state = verifyResult;
  }

  @override
  Future<void> resendCode({
    required String email,
    required AccountCodePurpose purpose,
  }) async {
    resendCalls++;
    state = const AccountAuthState(
      status: AccountAuthStatus.verificationSent,
      codePurpose: AccountCodePurpose.verify,
    );
  }

  @override
  Future<void> requestPasswordReset({required String email}) async {
    state = const AccountAuthState(
      status: AccountAuthStatus.verificationSent,
      codePurpose: AccountCodePurpose.reset,
    );
  }

  @override
  Future<void> confirmPasswordReset({
    required String email,
    required String newPassword,
  }) async {
    state = resetResult;
  }

  @override
  Future<void> claimAccount({
    required String email,
    required String password,
  }) async {
    claimCalls++;
    state = const AccountAuthState(
      status: AccountAuthStatus.verificationSent,
      codePurpose: AccountCodePurpose.verify,
    );
  }
}
