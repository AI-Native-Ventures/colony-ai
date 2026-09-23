import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:buzz/features/auth/account_action_button.dart';
import 'package:buzz/features/auth/account_auth_provider.dart';
import 'package:buzz/features/auth/account_auth_types.dart';
import 'package:buzz/features/auth/auth_entry_page.dart';
import 'package:buzz/features/auth/claim_account_page.dart';
import 'package:buzz/features/auth/create_account_page.dart';
import 'package:buzz/features/auth/request_password_reset_page.dart';
import 'package:buzz/features/auth/sign_in_page.dart';
import 'package:buzz/features/auth/verify_code_page.dart';

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets('loading account action keeps an accessible label', (
    tester,
  ) async {
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
      tester.getSemantics(find.byType(FilledButton)).label,
      'Continue in progress',
    );
    semantics.dispose();
  });

  testWidgets(
    'entry offers account choices and keeps pairing behind Advanced',
    (tester) async {
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

      expect(find.text('Create account'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('Sign in'), findsOneWidget);
      expect(
        find.text('Advanced: use an existing Nostr identity'),
        findsOneWidget,
      );
      expect(find.textContaining('key'), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Continue with Google'),
            )
            .onPressed,
        isNull,
      );

      await tester.tap(find.text('Advanced: use an existing Nostr identity'));
      await tester.pumpAndSettle();
      expect(find.text('Existing identity pairing'), findsOneWidget);
    },
  );

  testWidgets('signup validates locally and opens code verification', (
    tester,
  ) async {
    final auth = _FakeAccountAuthNotifier();
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: _overrides(auth),
        child: const CreateAccountPage(),
      ),
    );

    await tester.enterText(
      find.byType(TextFormField).at(0),
      'person@example.com',
    );
    await tester.enterText(find.byType(TextFormField).at(1), 'short');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await _pumpFormResult(tester);
    expect(find.text('Use at least 10 characters.'), findsOneWidget);
    expect(auth.signUpCalls, 0);

    await tester.enterText(find.byType(TextFormField).at(1), 'password-1234');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await _pumpFormResult(tester);
    expect(auth.signUpCalls, 1);
    expect(find.text('Check your email'), findsOneWidget);
    expect(find.textContaining('person@example.com'), findsOneWidget);
    expect(find.text('Verify email'), findsOneWidget);
  });

  testWidgets(
    'sign-in shows invalid credentials and handles unverified email',
    (tester) async {
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
          child: const SignInPage(),
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
      expect(find.text('6-digit code'), findsOneWidget);
    },
  );

  testWidgets('verification shows expired-code state and resend confirmation', (
    tester,
  ) async {
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

    await tester.enterText(find.byType(TextFormField), '123456');
    await tester.tap(find.widgetWithText(FilledButton, 'Verify email'));
    await _pumpFormResult(tester);
    expect(
      find.text('That code expired. Request a new one and try again.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Send a new code'));
    await _pumpFormResult(tester);
    expect(find.text('A new code has been sent.'), findsOneWidget);
    expect(auth.resendCalls, 1);
  });

  testWidgets('forgot password stays generic and reset errors remain visible', (
    tester,
  ) async {
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
    await tester.tap(find.widgetWithText(FilledButton, 'Send reset code'));
    await _pumpFormResult(tester);
    expect(find.text('Choose a new password'), findsOneWidget);
    expect(find.textContaining('If an account uses'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).at(0), '123456');
    await tester.enterText(find.byType(TextFormField).at(1), 'password-1234');
    await tester.tap(find.widgetWithText(FilledButton, 'Reset password'));
    await _pumpFormResult(tester);
    expect(
      find.text('Use a password with at least 10 characters.'),
      findsOneWidget,
    );
  });

  testWidgets('claim form never asks the user to paste an identity secret', (
    tester,
  ) async {
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
    status: AccountAuthStatus.complete,
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
    required String code,
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
