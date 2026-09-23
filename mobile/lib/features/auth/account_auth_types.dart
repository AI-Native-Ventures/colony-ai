/// Code purpose accepted by the relay's resend endpoint.
enum AccountCodePurpose { verify, reset }

/// User-safe failure category returned by the account client.
enum AccountAuthFailureKind {
  invalidRequest,
  invalidCredentials,
  emailUnverified,
  emailTaken,
  identityTaken,
  codeExpired,
  weakPassword,
  rateLimited,
  accountMissing,
  googleNotConfigured,
  googleCancelled,
  localStorage,
  invalidResponse,
  unavailable,
}

/// A typed account failure with an optional relay-provided retry delay.
class AccountAuthFailure implements Exception {
  /// Creates a safe failure with an optional retry delay.
  const AccountAuthFailure(this.kind, {this.retryAfterSecs});

  final AccountAuthFailureKind kind;
  final int? retryAfterSecs;
}

/// Account details returned in a session or by `GET /api/accounts/me`.
class AccountProfile {
  /// Creates the public account details returned by the relay.
  const AccountProfile({
    required this.id,
    required this.email,
    required this.pubkey,
    required this.hasPassword,
    required this.googleLinked,
  });

  final String id;
  final String email;
  final String pubkey;
  final bool hasPassword;
  final bool googleLinked;

  factory AccountProfile.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final email = json['email'];
    final pubkey = json['pubkey'];
    final hasPassword = json['has_password'];
    final googleLinked = json['google_linked'];
    if (id is! String ||
        email is! String ||
        pubkey is! String ||
        hasPassword is! bool ||
        googleLinked is! bool) {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }
    return AccountProfile(
      id: id,
      email: email,
      pubkey: pubkey,
      hasPassword: hasPassword,
      googleLinked: googleLinked,
    );
  }
}

/// A successful account authentication response.
///
/// The signing secret is kept inside the auth notifier and is never included
/// in provider state or passed to a widget.
class AccountSession {
  /// Creates a successful account session returned by the relay.
  const AccountSession({required this.account, required this.secret});

  final AccountProfile account;
  final String secret;

  factory AccountSession.fromJson(Map<String, dynamic> json) {
    final accountJson = json['account'];
    final secret = json['nsec'];
    if (accountJson is! Map || secret is! String || secret.isEmpty) {
      throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
    }
    return AccountSession(
      account: AccountProfile.fromJson(Map<String, dynamic>.from(accountJson)),
      secret: secret,
    );
  }
}

/// Current state of an account action shown by account screens.
enum AccountAuthStatus { idle, loading, verificationSent, complete, failed }

/// Widget-safe state for account actions. It deliberately contains no nsec.
class AccountAuthState {
  /// Creates widget-safe state for an account action.
  const AccountAuthState({
    this.status = AccountAuthStatus.idle,
    this.email,
    this.codePurpose,
    this.failure,
  });

  final AccountAuthStatus status;
  final String? email;
  final AccountCodePurpose? codePurpose;
  final AccountAuthFailure? failure;

  bool get isLoading => status == AccountAuthStatus.loading;
}

/// Result of checking whether the active identity has an account.
enum AccountLinkStatus { linked, needsClaim, tryAgainLater }

/// State for the persistent account-claim prompt on an authenticated home.
class AccountLinkState {
  /// Creates a linkage status for the home screen prompt.
  const AccountLinkState(this.status);

  final AccountLinkStatus status;
}
