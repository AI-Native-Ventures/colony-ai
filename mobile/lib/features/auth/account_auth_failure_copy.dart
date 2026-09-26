import 'account_auth_types.dart';

/// Short, actionable account error text for the existing mobile UI style.
String accountAuthFailureCopy(
  AccountAuthFailure failure,
) => switch (failure.kind) {
  AccountAuthFailureKind.invalidRequest => 'Check the details and try again.',
  AccountAuthFailureKind.invalidCredentials =>
    'That email or password did not match.',
  AccountAuthFailureKind.emailUnverified =>
    'Check your email for a verification code.',
  AccountAuthFailureKind.emailTaken =>
    'An account already uses that email. Sign in instead.',
  AccountAuthFailureKind.identityTaken =>
    'This identity is already linked to an account.',
  AccountAuthFailureKind.codeExpired =>
    'That code has expired. Request a new code. Your account details are kept.',
  AccountAuthFailureKind.wrongCode =>
    failure.attemptsLeft == null
        ? 'That code isn’t right. Check the six digits and try again.'
        : 'That code isn’t right. ${failure.attemptsLeft} ${failure.attemptsLeft == 1 ? 'attempt' : 'attempts'} left. Check the six digits and try again.',
  AccountAuthFailureKind.tooManyAttempts =>
    failure.retryAfterSecs == null || failure.retryAfterSecs == 0
        ? 'Too many attempts. The wait is over. Resend a fresh code to continue.'
        : 'Too many attempts. Try again in ${failure.retryAfterSecs}s. You can resend a code after the wait.',
  AccountAuthFailureKind.resendCooldown =>
    failure.retryAfterSecs == null || failure.retryAfterSecs == 0
        ? 'Resend code when the countdown ends.'
        : 'Resend code in ${failure.retryAfterSecs}s.',
  AccountAuthFailureKind.weakPassword =>
    'Use a password with at least 10 characters.',
  AccountAuthFailureKind.rateLimited =>
    failure.retryAfterSecs == null || failure.retryAfterSecs == 0
        ? 'Too many attempts. Try again later.'
        : 'Too many attempts. Try again in ${failure.retryAfterSecs} seconds.',
  AccountAuthFailureKind.accountMissing =>
    'This identity is not linked to an account yet.',
  AccountAuthFailureKind.googleNotConfigured =>
    'Google sign-in is not available in this build.',
  AccountAuthFailureKind.googleCancelled => 'Sign-in was cancelled.',
  AccountAuthFailureKind.localStorage =>
    'Could not save this account on this device. Sign in again to try again.',
  AccountAuthFailureKind.invalidResponse =>
    'The account service returned an unexpected response. Try again later.',
  AccountAuthFailureKind.unavailable =>
    'Could not reach the account service. Try again later.',
};

/// Title for a verification or reset code status callout.
String? accountCodeStatusTitle(AccountAuthFailure failure) =>
    switch (failure.kind) {
      AccountAuthFailureKind.codeExpired => 'That code has expired',
      AccountAuthFailureKind.wrongCode => 'That code isn’t right.',
      AccountAuthFailureKind.tooManyAttempts => 'Too many attempts.',
      AccountAuthFailureKind.unavailable => 'Couldn’t verify your code.',
      _ => null,
    };

/// Detail for a verification or reset code status callout.
String? accountCodeStatusDetail(
  AccountAuthFailure failure, {
  int? remainingSecs,
}) => switch (failure.kind) {
  AccountAuthFailureKind.codeExpired =>
    'Request a new code. Your account details are kept.',
  AccountAuthFailureKind.wrongCode =>
    failure.attemptsLeft == null
        ? 'Check the six digits and try again.'
        : '${failure.attemptsLeft} ${failure.attemptsLeft == 1 ? 'attempt' : 'attempts'} left. Check the six digits and try again.',
  AccountAuthFailureKind.tooManyAttempts =>
    'Try again in ${remainingSecs ?? failure.retryAfterSecs ?? 0}s. You can resend a code after the wait.',
  AccountAuthFailureKind.unavailable =>
    'Check your connection and try again. No attempt was used.',
  _ => null,
};
