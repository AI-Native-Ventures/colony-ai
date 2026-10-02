# Buzz Mobile

Flutter mobile client for Buzz.

See [VISION_MOBILE.md](../VISION_MOBILE.md) for intended behavior and
architecture.

## Setup

Use the Flutter SDK pinned by the repository. Activate Hermit from the repo
root before resolving packages or running any Flutter command:

```bash
cd /path/to/buzz
. ./bin/activate-hermit
./bin/just mobile-install
```

`mobile-build-android` intentionally builds with `--no-pub`. If an IDE or an
external Flutter SDK has touched `mobile/.dart_tool`, rerun `mobile-install`
with the pinned SDK before building so `flutter_test`, `sky_engine`, and the
engine all come from the same Flutter version.

## Run

```bash
# From repo root (applies a worktree-isolated debug identity and starts/reuses Simulator):
just mobile-dev

# Direct (uses the app's configured community; apply worktree overrides first):
cd mobile && flutter run --dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example
```

### Google account sign-in

Google sign-in reads public OAuth client IDs from Dart defines. For a local
iOS dogfood build, load these public values from the repository variables in
`AI-Native-Ventures/colony-ai` into your shell:

```bash
export COLONY_GOOGLE_WEB_CLIENT_ID='<web client id>'
export COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID='<iOS dogfood client id>'
export COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME='<iOS dogfood URL scheme>'
COLONY_GOOGLE_REVERSED_CLIENT_ID="$COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME" \
  ./scripts/mobile-google-auth-xcconfig.sh dogfood
cd mobile && flutter run \
  --dart-define="COLONY_GOOGLE_IOS_CLIENT_ID=$COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID" \
  --dart-define="COLONY_GOOGLE_SERVER_CLIENT_ID=$COLONY_GOOGLE_WEB_CLIENT_ID"
```

The helper writes an ignored Xcode config used by Debug builds. For a local iOS
release build, use the release client and scheme from repository variables:

```bash
export COLONY_GOOGLE_IOS_CLIENT_ID='<iOS release client id>'
export COLONY_GOOGLE_IOS_URL_SCHEME='<iOS release URL scheme>'
export COLONY_GOOGLE_WEB_CLIENT_ID='<web client id>'
COLONY_GOOGLE_REVERSED_CLIENT_ID="$COLONY_GOOGLE_IOS_URL_SCHEME" \
  ./scripts/mobile-google-auth-xcconfig.sh release
cd mobile && flutter build ios --release --no-codesign \
  --dart-define="COLONY_GOOGLE_IOS_CLIENT_ID=$COLONY_GOOGLE_IOS_CLIENT_ID" \
  --dart-define="COLONY_GOOGLE_SERVER_CLIENT_ID=$COLONY_GOOGLE_WEB_CLIENT_ID"
```

GitHub builds read these public values from repository variables and select the
matching iOS flavor. No Google client secret is used by mobile.

Android Google sign-in is still pending. Register an Android OAuth client after
the release signing SHA-1 is available from CI signing, then add its native
configuration before enabling Android sign-in. Until then, mobile builds pass
the web server client ID only, and Android Google sign-in is not configured.

### Worktree-aware debug identity

Debug builds produced from a git worktree get a unique app identifier keyed
to the **worktree directory name**
(`ventures.ainative.colony.dogfood.<slug>` on iOS and Android) plus a
display-only branch label
in the app name (`Buzz (my-branch)`, or a short SHA when the worktree is
detached). Because the identifier follows the directory rather than the
branch, one worktree keeps exactly one installed app — and its login state —
across branch switches, and builds from multiple worktrees install side by
side, mirroring the desktop dev experience. Release and profile builds
always keep the production identity and name.

`just mobile-dev` and `just mobile-build-android` apply this automatically by
running `scripts/mobile-worktree-overrides.sh`, which writes two gitignored
files:

- `mobile/ios/Flutter/WorktreeOverrides.xcconfig` (included by Debug builds
  only; a developer's `AppOverrides.xcconfig` is included after it, so
  app-specific overrides like a personal `BUNDLE_IDENTIFIER` for device
  signing always win)
- `mobile/android/worktree.properties` (read by the debug build type only)

Android developers can keep a stable local test identity that takes precedence
over the generated worktree values by creating the gitignored
`mobile/android/AppOverrides.properties`:

```properties
appName=Buzz Pairing
applicationIdSuffix=.device_pairing_e2e1
```

These values are consumed by the debug build type only. The standard
`just mobile-build-android` command can still be used; regenerating
`worktree.properties` does not overwrite `AppOverrides.properties`. Release
and profile builds keep the production `Buzz` name and application ID.

For direct Xcode / Android Studio / `flutter run` development, run
`./scripts/mobile-worktree-overrides.sh` from the repo root once per branch
switch to refresh the display label (the install identity never changes);
the persisted files are then picked up by any subsequent build. In the main
checkout the script is a no-op that removes stale override files, restoring
the standard dogfood ID and `Buzz` label. To enable push in direct Xcode builds
and Runner tests, supply a `BUZZ_PUSH_GATEWAY_URL` build setting in the gitignored
`mobile/ios/Flutter/AppOverrides.xcconfig`; the build phase validates and
passes it through as a Flutter Dart define. Since `//` begins an xcconfig
comment, spell the origin as `BUZZ_PUSH_GATEWAY_URL = https:/$()/push.example`.

For an Android debug build that must remain installed alongside other Buzz
worktree builds, set an explicit launcher name and package suffix when invoking
the generator or a recipe that invokes it:

```bash
BUZZ_PUSH_GATEWAY_URL="https://push.example" \
BUZZ_ANDROID_DEBUG_APP_NAME="Buzz Huddles" \
BUZZ_ANDROID_DEBUG_ID_SUFFIX=".huddles_829c" \
./bin/just mobile-build-android
```

This example produces the debug-only package
`ventures.ainative.colony.huddles_829c` with the launcher label `Buzz Huddles`.
The suffix must start with a dot followed by a lowercase letter and may contain
only lowercase letters, digits, and underscores. Release and profile builds
ignore these overrides and retain the production package and name.

To remove leftover worktree-suffixed installs from booted iOS simulators and
connected Android emulators, run `just mobile-clean` (add `--dry-run` via
`./scripts/mobile-worktree-clean.sh --dry-run` to preview). Production
installs are never touched.

### iOS push capability

Every iOS artifact builds and embeds the Notification Service Extension and
native push bridge. Runtime activation is fail-closed and scoped to the current
relay. After authenticated connectivity and a fully valid NIP-11 `nip-pl` push
descriptor, Buzz independently requests display permission and registers with
APNs. Display denial or request failure does not gate the device token, gateway
enrollment, or lease publication, so a later user opt-in can display pushes
without rebuilding transport authority. An absent, malformed, or unreachable
descriptor leaves push inactive without partial enrollment.

Mobile builds without a gateway origin succeed with push unavailable. To enable
push, supply the gateway origin explicitly:

```bash
flutter build ios --dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example
flutter build apk --dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example
```

The iOS and Android build gates validate any supplied define, rejecting empty or
malformed values. Release/profile builds require an HTTPS origin without an
explicit port. An absent define disables permission requests, APNs registration,
gateway enrollment, and lease publication; Settings shows push as unavailable.
No production gateway is selected implicitly. Enrollment
grants and crash-recovery journals are scoped to this origin. Push has not
shipped to existing users, so there is no legacy-state or cross-gateway
migration. Changing gateways requires fresh enrollment; old installations
expire under their original gateway's lease policy. Current-gateway response
loss is still retried from the exact journaled request.

Relay rollout remains an explicit deployment opt-in. Only deployments with
`BUZZ_PUSH_ENABLED=true` advertise the descriptor and process push. See
`docs/push-gateway-deployment.md` for the canonical gateway profile contract,
manual physical-device proof, measurements, and rollback procedure.

For local physical-device development, override the identity and sandbox
environments in the gitignored `mobile/ios/Flutter/AppOverrides.xcconfig`:

```xcconfig
BUNDLE_IDENTIFIER = ventures.ainative.colony
BUZZ_DEVELOPMENT_TEAM = EYF346PHUG
BUZZ_IOS_PUSH_ENVIRONMENT = development
BUZZ_APP_ATTEST_ENVIRONMENT = development
BUZZ_PUSH_GATEWAY_URL = https:/$()/push.example
```

This exercises the client, extension, relay, and gateway integration without
requiring a dogfood development signing identity. It uses the canonical
gateway's server-owned App Store profile configured for sandbox in the local
development gateway; it does not validate the internally distributed dogfood
artifact or enable the App Store profile in production. Validate dogfood APNs
end to end by cutting an internal release, waiting for it to reach Mobile
Releases/Comp Portal, and installing that signed artifact on a physical device.

The Colony production and dogfood bundle IDs, their Notification Service
Extension IDs, App Groups, Keychain access groups, App Attest IDs, and APNs
topics must be registered in the Apple Developer portal with matching
capabilities and regenerated provisioning profiles before signed distribution.
The Notification Service Extension profile does not require the parent's
Communication Notifications capability. Without matching registrations,
source and simulator validation still work, but the app cannot be signed for a
physical device.

APNs and the gateway continue to carry only the constant opaque wake-up. The
extension fetches the message from the scoped relay, verifies message, sender
profile, and channel-metadata signatures, and uses a bounded App Group cache
for names and app-rendered avatar thumbnails. It never fetches an avatar URL;
missing, stale, or invalid enrichment falls back to the verified message with a
short sender pubkey, community subtitle, and no image.

## Checks

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test --dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example
```

Or from the repo root: `just mobile-check` and `just mobile-test`.

## Android release signing

Android release builds fail unless all upload-key inputs are supplied through the
environment:

- `BUZZ_ANDROID_UPLOAD_KEYSTORE_PATH`: path to a CI-vended keystore file
- `BUZZ_ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `BUZZ_ANDROID_UPLOAD_KEY_ALIAS`
- `BUZZ_ANDROID_UPLOAD_KEY_PASSWORD`

The keystore path must be absolute, and the keystore must remain outside the
repository. By default, development and debug builds use Android's debug key
and do not require these variables.

The Colony Android emulator runtime workflow uses the same upload key for its
debug APK when `COLONY_ANDROID_UPLOAD_KEYSTORE_B64`,
`COLONY_ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `COLONY_ANDROID_UPLOAD_KEY_PASSWORD`,
and the `COLONY_ANDROID_UPLOAD_KEY_ALIAS` repository variable are configured.
It decodes the keystore under the runner's temporary directory and removes it
after the build. Set `BUZZ_ANDROID_DEBUG_SIGNING=upload-keystore` to opt into
that signing mode in other controlled CI builds.

Release pipelines that sign through the central APK Signer service instead of
a local upload keystore must set `BUZZ_ANDROID_RELEASE_SIGNING=external`. That
mode produces an unsigned release bundle and refuses to run if any
`BUZZ_ANDROID_UPLOAD_*` value is also set.

The in-repo mobile release-candidate workflow only creates a source tag; it
does not build a signed Android release. Any release builder that invokes
Gradle for a signed Android artifact must provide the upload key outside the
checkout and set the four `BUZZ_ANDROID_UPLOAD_*` variables above.

## Architecture

```
lib/
├── main.dart              # Entry point, Riverpod bootstrap
├── app.dart               # MaterialApp with theme
├── shared/
│   └── theme/             # Catppuccin light/dark, spacing tokens, extensions
└── features/
    └── home/              # Placeholder home surface
```

- **State management:** Riverpod + Hooks (`HookConsumerWidget`)
- **Theme:** Catppuccin Latte (light) / Macchiato (dark) — matches desktop
- **Spacing:** `Grid` tokens for consistent spacing
- **Linting:** `flutter_lints` + `riverpod_lint` via `custom_lint`
- **Feature isolation:** No cross-feature imports except `shared/`
