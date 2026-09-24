/// Public OAuth client identifiers supplied by the mobile build.
///
/// Pass these values with Dart defines or `--dart-define-from-file`. iOS also
/// needs `COLONY_GOOGLE_REVERSED_CLIENT_ID` in its Xcode build configuration
/// for the native sign-in callback URL scheme in Runner/Info.plist.
class AccountBuildConfig {
  const AccountBuildConfig._();

  /// iOS OAuth client id used by the platform Google sign-in SDK.
  static const googleIosClientId = String.fromEnvironment(
    'COLONY_GOOGLE_IOS_CLIENT_ID',
  );

  /// Server OAuth client id used to request a backend-verifiable ID token.
  static const googleServerClientId = String.fromEnvironment(
    'COLONY_GOOGLE_SERVER_CLIENT_ID',
  );
}
