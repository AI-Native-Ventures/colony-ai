#!/bin/bash
# Exercise the production recipes with macOS's system Bash, not a rewritten copy.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/scripts" "$fixture/mobile/ios/Flutter"
cp "$repo_root/scripts/mobile-google-auth-xcconfig.sh" \
  "$fixture/scripts/mobile-google-auth-xcconfig.sh"
chmod +x "$fixture/scripts/mobile-google-auth-xcconfig.sh"
for recipe in mobile-dev mobile-build-android; do
  # Render with the real task runner before installing stubs: a Hermit just
  # shim can otherwise prepend the real Flutter to PATH ahead of our stub.
  just --justfile "$repo_root/Justfile" --dry-run "$recipe" > "$fixture/$recipe" 2>&1
done
cat > "$fixture/bin/flutter" <<'STUB'
#!/bin/bash
set -eu
printf '%s\n' "$@" > "$CALL_LOG"
STUB
cat > "$fixture/bin/pgrep" <<'STUB'
#!/bin/bash
exit 0
STUB
cat > "$fixture/scripts/mobile-worktree-overrides.sh" <<'STUB'
#!/bin/bash
exit 0
STUB
chmod +x "$fixture/bin/flutter" "$fixture/bin/pgrep" "$fixture/scripts/mobile-worktree-overrides.sh"
export PATH="$fixture/bin:$PATH"
export CALL_LOG="$fixture/arguments"
unset BUZZ_PUSH_GATEWAY_URL COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID
unset COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME COLONY_GOOGLE_SERVER_CLIENT_ID
unset COLONY_GOOGLE_WEB_CLIENT_ID COLONY_GOOGLE_REVERSED_CLIENT_ID

for recipe in mobile-dev mobile-build-android; do
  for mode in omitted supplied; do
    unset BUZZ_PUSH_GATEWAY_URL
    if [[ "$mode" == supplied ]]; then
      # A space catches accidental splitting. The build gate validates URLs;
      # this test checks exact argument forwarding.
      export BUZZ_PUSH_GATEWAY_URL='https://push.example/value with space'
    fi
    (cd "$fixture" && /bin/bash "$fixture/$recipe")
    if [[ "$recipe" == mobile-dev ]]; then
      printf '%s\n' run > "$fixture/expected"
    else
      printf '%s\n' build apk --debug --no-pub > "$fixture/expected"
    fi
    if [[ "$mode" == supplied ]]; then
      printf '%s\n' "--dart-define=BUZZ_PUSH_GATEWAY_URL=$BUZZ_PUSH_GATEWAY_URL" >> "$fixture/expected"
    fi
    diff -u "$fixture/expected" "$CALL_LOG"
    printf 'PASS %s %s\n' "$recipe" "$mode"
  done
done

unset BUZZ_PUSH_GATEWAY_URL
printf '%s\n' 'BUZZ_PUSH_GATEWAY_URL = https:/$()/push.example' > "$fixture/mobile/ios/Flutter/AppOverrides.xcconfig"
(cd "$fixture" && /bin/bash "$fixture/mobile-dev")
printf '%s\n' run '--dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example' > "$fixture/expected"
diff -u "$fixture/expected" "$CALL_LOG"
printf 'PASS mobile-dev Xcode override\n'

export COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID='generated-test-dogfood-client-id'
export COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME='com.googleusercontent.apps.generated-dogfood'
export COLONY_GOOGLE_SERVER_CLIENT_ID='generated-test-web-client-id'
(cd "$fixture" && /bin/bash "$fixture/mobile-dev")
printf '%s\n' run \
  '--dart-define=BUZZ_PUSH_GATEWAY_URL=https://push.example' \
  "--dart-define=COLONY_GOOGLE_IOS_CLIENT_ID=$COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID" \
  "--dart-define=COLONY_GOOGLE_SERVER_CLIENT_ID=$COLONY_GOOGLE_SERVER_CLIENT_ID" \
  >"$fixture/expected"
diff -u "$fixture/expected" "$CALL_LOG"
printf '%s\n' \
  'COLONY_GOOGLE_REVERSED_CLIENT_ID = com.googleusercontent.apps.generated-dogfood' \
  >"$fixture/expected"
diff -u "$fixture/expected" "$fixture/mobile/ios/Flutter/GoogleAuthDebug.xcconfig"
grep -q '#include? "GoogleAuthDebug.xcconfig"' \
  "$repo_root/mobile/ios/Flutter/Debug.xcconfig"
printf 'PASS mobile-dev dogfood Google configuration\n'

COLONY_GOOGLE_REVERSED_CLIENT_ID='com.googleusercontent.apps.generated-release' \
  /bin/bash "$fixture/scripts/mobile-google-auth-xcconfig.sh" release
printf '%s\n' \
  'COLONY_GOOGLE_REVERSED_CLIENT_ID = com.googleusercontent.apps.generated-release' \
  >"$fixture/expected"
diff -u "$fixture/expected" "$fixture/mobile/ios/Flutter/GoogleAuthRelease.xcconfig"
grep -q '#include? "GoogleAuthRelease.xcconfig"' \
  "$repo_root/mobile/ios/Flutter/Release.xcconfig"
git -C "$repo_root" check-ignore -q mobile/ios/Flutter/GoogleAuthDebug.xcconfig
git -C "$repo_root" check-ignore -q mobile/ios/Flutter/GoogleAuthRelease.xcconfig
printf 'PASS iOS release Google callback configuration\n'

unset COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME
(cd "$fixture" && /bin/bash "$fixture/mobile-build-android")
printf '%s\n' build apk --debug --no-pub \
  "--dart-define=COLONY_GOOGLE_SERVER_CLIENT_ID=$COLONY_GOOGLE_SERVER_CLIENT_ID" \
  >"$fixture/expected"
diff -u "$fixture/expected" "$CALL_LOG"
printf 'PASS mobile-build-android server client ID\n'
