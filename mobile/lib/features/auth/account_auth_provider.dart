import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/auth/auth_provider.dart';
import '../../shared/community/community.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/relay/relay_provider.dart';
import 'account_api.dart';
import 'account_auth_types.dart';
import 'account_claim_status_provider.dart';
import 'account_google_sign_in.dart';

/// Owns account workflows and keeps signing secrets out of widget state.
final accountAuthProvider =
    NotifierProvider<AccountAuthNotifier, AccountAuthState>(
      AccountAuthNotifier.new,
    );

/// Runs public account flows and hands successful identities to local storage.
class AccountAuthNotifier extends Notifier<AccountAuthState> {
  String? _pendingResetEmail;
  String? _pendingResetCode;

  @override
  AccountAuthState build() => const AccountAuthState();

  /// Clears transient account form state.
  void reset() {
    _clearPendingResetCode();
    state = const AccountAuthState();
  }

  /// Creates an account and sends its verification code.
  Future<void> signUp({
    required String displayName,
    required String email,
    required String password,
  }) async {
    final normalizedEmail = _normalizeEmail(email);
    await _run(
      () => ref
          .read(accountApiProvider)
          .signup(
            displayName: displayName.trim(),
            email: normalizedEmail,
            password: password,
          ),
      successStatus: AccountAuthStatus.verificationSent,
      email: normalizedEmail,
      codePurpose: AccountCodePurpose.verify,
    );
  }

  /// Signs in and persists the returned identity locally.
  Future<void> signIn({required String email, required String password}) async {
    final normalizedEmail = _normalizeEmail(email);
    state = AccountAuthState(
      status: AccountAuthStatus.loading,
      email: normalizedEmail,
    );
    try {
      final session = await ref
          .read(accountApiProvider)
          .signIn(email: normalizedEmail, password: password);
      await _persistSession(session);
      state = const AccountAuthState(status: AccountAuthStatus.complete);
    } on AccountAuthFailure catch (failure) {
      if (failure.kind == AccountAuthFailureKind.emailUnverified) {
        state = AccountAuthState(
          status: AccountAuthStatus.verificationSent,
          email: normalizedEmail,
          codePurpose: AccountCodePurpose.verify,
        );
      } else {
        state = AccountAuthState(
          status: AccountAuthStatus.failed,
          email: normalizedEmail,
          failure: failure,
        );
      }
    } catch (_) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        failure: const AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  /// Verifies a code and persists the authenticated identity locally.
  Future<void> verifyCode({required String email, required String code}) async {
    final normalizedEmail = _normalizeEmail(email);
    await _run(
      () async {
        final session = await ref
            .read(accountApiProvider)
            .verify(email: normalizedEmail, code: code.trim());
        await _persistSession(session);
        return null;
      },
      successStatus: AccountAuthStatus.complete,
      email: normalizedEmail,
    );
  }

  /// Requests another verification or reset code.
  Future<void> resendCode({
    required String email,
    required AccountCodePurpose purpose,
  }) async {
    final normalizedEmail = _normalizeEmail(email);
    if (purpose == AccountCodePurpose.reset) _clearPendingResetCode();
    await _run(
      () => ref
          .read(accountApiProvider)
          .resendCode(email: normalizedEmail, purpose: purpose),
      successStatus: AccountAuthStatus.verificationSent,
      email: normalizedEmail,
      codePurpose: purpose,
    );
  }

  /// Requests a password reset code without revealing account existence.
  Future<void> requestPasswordReset({required String email}) async {
    final normalizedEmail = _normalizeEmail(email);
    _clearPendingResetCode();
    await _run(
      () => ref
          .read(accountApiProvider)
          .requestPasswordReset(email: normalizedEmail),
      successStatus: AccountAuthStatus.verificationSent,
      email: normalizedEmail,
      codePurpose: AccountCodePurpose.reset,
    );
  }

  /// Checks a reset code before the user enters a new password.
  Future<void> checkPasswordResetCode({
    required String email,
    required String code,
  }) async {
    final normalizedEmail = _normalizeEmail(email);
    final normalizedCode = code.trim();
    _clearPendingResetCode();
    state = AccountAuthState(
      status: AccountAuthStatus.loading,
      email: normalizedEmail,
      codePurpose: AccountCodePurpose.reset,
    );
    try {
      await ref
          .read(accountApiProvider)
          .checkPasswordResetCode(email: normalizedEmail, code: normalizedCode);
      _pendingResetEmail = normalizedEmail;
      _pendingResetCode = normalizedCode;
      state = AccountAuthState(
        status: AccountAuthStatus.codeVerified,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
      );
    } on AccountAuthFailure catch (failure) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
        failure: failure,
        retryAfterSecs: failure.retryAfterSecs,
      );
    } catch (_) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
        failure: const AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  /// Discards the code when a reset flow is exited or sent back to code entry.
  void discardStagedPasswordResetCode() => _clearPendingResetCode();

  /// Confirms the staged reset code and returns the user to sign-in.
  Future<void> confirmPasswordReset({
    required String email,
    required String newPassword,
  }) async {
    final normalizedEmail = _normalizeEmail(email);
    final code = _pendingResetEmail == normalizedEmail
        ? _pendingResetCode
        : null;
    if (code == null || code.isEmpty) {
      _clearPendingResetCode();
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
        failure: const AccountAuthFailure(
          AccountAuthFailureKind.invalidRequest,
        ),
      );
      return;
    }
    state = AccountAuthState(
      status: AccountAuthStatus.loading,
      email: normalizedEmail,
      codePurpose: AccountCodePurpose.reset,
    );
    try {
      final api = ref.read(accountApiProvider);
      // The reset response carries a session, but the design returns to sign
      // in with the new password ("Password updated"), so it is not adopted.
      await api.confirmPasswordReset(
        email: normalizedEmail,
        code: code,
        newPassword: newPassword,
      );
      _clearPendingResetCode();
      state = AccountAuthState(
        status: AccountAuthStatus.resetComplete,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
      );
    } on AccountAuthFailure catch (failure) {
      _clearPendingResetCode();
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
        failure: failure,
        retryAfterSecs: failure.retryAfterSecs,
      );
    } catch (_) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.reset,
        failure: const AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  /// Signs in through Google and persists the returned identity locally.
  Future<void> continueWithGoogle() async {
    state = const AccountAuthState(status: AccountAuthStatus.loading);
    try {
      final idToken = await ref
          .read(accountGoogleSignInProvider)
          .authenticateForIdToken();
      if (idToken == null) {
        state = const AccountAuthState();
        return;
      }
      final session = await ref
          .read(accountApiProvider)
          .signInWithGoogle(idToken: idToken);
      await _persistSession(session);
      state = const AccountAuthState(status: AccountAuthStatus.complete);
    } on AccountAuthFailure catch (failure) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        failure: failure,
      );
    } catch (_) {
      state = const AccountAuthState(
        status: AccountAuthStatus.failed,
        failure: AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  /// Starts claiming the identity stored in the active community.
  Future<void> claimAccount({
    required String email,
    required String password,
  }) async {
    final normalizedEmail = _normalizeEmail(email);
    state = AccountAuthState(
      status: AccountAuthStatus.loading,
      email: normalizedEmail,
      codePurpose: AccountCodePurpose.verify,
    );
    try {
      final community = await ref.read(activeCommunityProvider.future);
      final nsec = community?.nsec;
      if (nsec == null || nsec.isEmpty) {
        throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
      }
      await ref
          .read(accountApiProvider)
          .claim(email: normalizedEmail, password: password, nsec: nsec);
      state = AccountAuthState(
        status: AccountAuthStatus.verificationSent,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.verify,
      );
    } on AccountAuthFailure catch (failure) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.verify,
        failure: failure,
      );
    } catch (_) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: normalizedEmail,
        codePurpose: AccountCodePurpose.verify,
        failure: const AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  Future<void> _run(
    Future<AccountCodeDelivery?> Function() operation, {
    required AccountAuthStatus successStatus,
    String? email,
    AccountCodePurpose? codePurpose,
  }) async {
    state = AccountAuthState(
      status: AccountAuthStatus.loading,
      email: email,
      codePurpose: codePurpose,
    );
    try {
      final delivery = await operation();
      state = AccountAuthState(
        status: successStatus,
        email: email,
        codePurpose: codePurpose,
        retryAfterSecs: delivery?.retryAfterSecs,
      );
    } on AccountAuthFailure catch (failure) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: email,
        codePurpose: codePurpose,
        failure: failure,
        retryAfterSecs: failure.retryAfterSecs,
      );
    } catch (_) {
      state = AccountAuthState(
        status: AccountAuthStatus.failed,
        email: email,
        codePurpose: codePurpose,
        failure: const AccountAuthFailure(AccountAuthFailureKind.unavailable),
      );
    }
  }

  Future<void> _persistSession(AccountSession session) async {
    final baseUrl = ref.read(relayConfigProvider).baseUrl;
    final expectedPubkey = session.account.pubkey.toLowerCase();
    final actualPubkey = pubkeyFromNsec(session.secret)?.toLowerCase();
    if (actualPubkey == null || actualPubkey != expectedPubkey) {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }

    try {
      final active = await ref.read(activeCommunityProvider.future);
      final community = active == null
          ? Community.create(
              name: Community.nameFromUrl(baseUrl),
              relayUrl: baseUrl,
              pubkey: session.account.pubkey,
              nsec: session.secret,
            )
          : active.copyWith(
              pubkey: session.account.pubkey,
              nsec: session.secret,
            );
      await ref
          .read(authProvider.notifier)
          .authenticateWithCommunity(community);
    } catch (_) {
      throw const AccountAuthFailure(AccountAuthFailureKind.localStorage);
    }
    ref.invalidate(accountLinkStatusProvider);
  }

  void _clearPendingResetCode() {
    _pendingResetEmail = null;
    _pendingResetCode = null;
  }
}

String _normalizeEmail(String email) => email.trim().toLowerCase();
