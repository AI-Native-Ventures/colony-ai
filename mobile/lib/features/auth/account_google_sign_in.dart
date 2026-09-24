import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'account_auth_types.dart';
import 'account_build_config.dart';

/// The narrow Google login seam used by account auth and its tests.
abstract interface class AccountGoogleSignIn {
  /// Authenticates with Google and returns its backend-verifiable ID token.
  Future<String?> authenticateForIdToken();
}

/// Provides the platform Google sign-in adapter.
final accountGoogleSignInProvider = Provider<AccountGoogleSignIn>((ref) {
  return PlatformAccountGoogleSignIn(
    iosClientId: AccountBuildConfig.googleIosClientId,
    serverClientId: AccountBuildConfig.googleServerClientId,
  );
});

/// Gets an ID token from Google's native sign-in SDK without requesting scopes.
class PlatformAccountGoogleSignIn implements AccountGoogleSignIn {
  /// Creates the adapter from public platform and server OAuth client IDs.
  PlatformAccountGoogleSignIn({
    required this.iosClientId,
    required this.serverClientId,
  });

  final String iosClientId;
  final String serverClientId;

  static Future<void>? _initialization;

  Future<void> _initialize() {
    if (serverClientId.isEmpty) {
      throw const AccountAuthFailure(
        AccountAuthFailureKind.googleNotConfigured,
      );
    }
    return _initialization ??= GoogleSignIn.instance.initialize(
      clientId: iosClientId.isEmpty ? null : iosClientId,
      serverClientId: serverClientId,
    );
  }

  @override
  Future<String?> authenticateForIdToken() async {
    try {
      await _initialize();
      if (!GoogleSignIn.instance.supportsAuthenticate()) {
        throw const AccountAuthFailure(
          AccountAuthFailureKind.googleNotConfigured,
        );
      }
      final user = await GoogleSignIn.instance.authenticate();
      final idToken = user.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const AccountAuthFailure(AccountAuthFailureKind.invalidResponse);
      }
      return idToken;
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) return null;
      if (error.code == GoogleSignInExceptionCode.clientConfigurationError ||
          error.code == GoogleSignInExceptionCode.providerConfigurationError) {
        throw const AccountAuthFailure(
          AccountAuthFailureKind.googleNotConfigured,
        );
      }
      rethrow;
    }
  }
}
