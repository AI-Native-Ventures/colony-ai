#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
cd "$repo_root"
. ./bin/activate-hermit

usage() {
  cat <<'EOF'
Usage: desktop-mobile-canary.sh ACTION [ARG]

Actions:
  prepare                   Build/install iOS, mint a one-use canary invite, open it
  desktop-wait MESSAGE      Open Electron and wait for this message from mobile
  desktop-send MESSAGE      Send this message from Electron to mobile
  desktop-thread ROOT REPLY Open the root thread and wait for its mobile reply
  mobile-screenshot LABEL   Save the current simulator screen as a PNG
  mobile-relaunch           Terminate and relaunch Buzz Mobile, then save a PNG
  mobile-background         Foreground Settings, restore Buzz, then save a PNG

Set COLONY_CANARY_INTEROP=1 for every invocation. The default run directory is
~/worktrees/.lanes/interop-proof-colony. Override it with
COLONY_INTEROP_RUN_DIR when running multiple independent sessions.
EOF
}

action="${1:-}"
if [[ "$action" == '-h' || "$action" == '--help' || "$action" == 'help' ]]; then
  usage
  exit 0
fi

if [[ "${COLONY_CANARY_INTEROP:-}" != "1" ]]; then
  printf '%s\n' 'Refusing to run. Set COLONY_CANARY_INTEROP=1 to opt in to the canary relay exercise.' >&2
  exit 2
fi

readonly owner_file="$HOME/worktrees/.lanes/users/user-a.json"
readonly channels_file="$HOME/worktrees/.lanes/users/user-a.channels.json"
readonly desktop_tools="$HOME/worktrees/.lanes/tools"
readonly native_host_source="$HOME/worktrees/.lanes/bin/colony-native-host"
readonly desktop_worktree="$HOME/worktrees/colony-p1-drive/desktop"
readonly electron_profile_source="$HOME/worktrees/.lanes/ud-a"
readonly expected_host='p1e-mudsa14i.canary.colony.ainative.ventures'
readonly expected_owner='e54a123a6c2c75b9210bd9be4e963572ab94e6397c7904aca7e24c932fd2665e'
readonly expected_general='078babdd-f7ce-509a-b5a1-e001c05e14e1'
readonly expected_mobile_bundle_id='xyz.block.buzz.dogfood.mobile'
readonly relay_root='wss://relay-canary.colony.ainative.ventures'
readonly run_dir="${COLONY_INTEROP_RUN_DIR:-$HOME/worktrees/.lanes/interop-proof-colony}"
readonly app_path="$repo_root/mobile/build/ios/iphonesimulator/Buzz.app"
interop_runner_cleanup=''
interop_step_cleanup=''

cleanup_interop_temps() {
  if [[ -n "$interop_runner_cleanup" && -e "$interop_runner_cleanup" ]]; then
    unlink "$interop_runner_cleanup"
  fi
  if [[ -n "$interop_step_cleanup" && -e "$interop_step_cleanup" ]]; then
    unlink "$interop_step_cleanup"
  fi
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ -r "$owner_file" ]] || fail "Missing canary owner file: $owner_file"
[[ -r "$channels_file" ]] || fail "Missing canary channels file: $channels_file"
[[ -x "$native_host_source" ]] || fail "Missing executable native host: $native_host_source"
[[ -d "$electron_profile_source" ]] || fail "Missing onboarded Electron profile: $electron_profile_source"
[[ -r "$desktop_tools/p1-drive.mjs" ]] || fail "Missing Electron runner: $desktop_tools/p1-drive.mjs"
[[ -r "$desktop_worktree/package.json" ]] || fail "Missing Electron Playwright worktree: $desktop_worktree"
[[ -r "$desktop_worktree/p1-read.tmp.mjs" ]] || fail "Missing canary relay read helper: $desktop_worktree/p1-read.tmp.mjs"

owner_host="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).host)' "$owner_file")"
owner_pubkey="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pubkey)' "$owner_file")"
channel_general="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).channel_general)' "$channels_file")"
[[ "$owner_host" == "$expected_host" ]] || fail "Refusing non-canary or unexpected tenant host: $owner_host"
[[ "$owner_pubkey" == "$expected_owner" ]] || fail 'Refusing an unexpected community owner identity'
[[ "$channel_general" == "$expected_general" ]] || fail 'Refusing an unexpected #general channel id'

booted_ios_ids="$(xcrun simctl list devices booted --json | node --input-type=module -e '
  let json = "";
  for await (const chunk of process.stdin) json += chunk;
  const devices = JSON.parse(json).devices;
  for (const [runtime, entries] of Object.entries(devices)) {
    if (!runtime.toLowerCase().includes("ios")) continue;
    for (const device of entries) if (device.state === "Booted") console.log(device.udid);
  }
')"
simulator_id="${COLONY_IOS_SIMULATOR:-$(printf '%s\n' "$booted_ios_ids" | sed -n '1p')}"
[[ -n "$simulator_id" ]] || fail 'Boot an iOS Simulator first, then rerun this script.'
printf '%s\n' "$booted_ios_ids" | rg -q -F "$simulator_id" || fail 'COLONY_IOS_SIMULATOR must name a booted iOS Simulator.'

mkdir -p "$run_dir"
chmod 700 "$run_dir"

require_prepared() {
  [[ -x "$run_dir/colony-native-host" ]] || fail 'Run the prepare action first to copy the native host.'
  [[ -s "$run_dir/mobile-bundle-id" ]] || fail 'Run the prepare action first to build and install Buzz Mobile.'
}

capture_mobile() {
  local label="$1"
  [[ "$label" =~ ^[a-zA-Z0-9._-]{1,64}$ ]] || fail 'Screenshot label must use letters, digits, dot, underscore, or hyphen.'
  local path="$run_dir/ios-${label}-$(date -u +%Y%m%dT%H%M%SZ)-$$.png"
  xcrun simctl io "$simulator_id" screenshot "$path"
  printf 'IOS_SCREENSHOT=%s\n' "$path"
}

launch_electron_step() {
  local mode="$1"
  local message="$2"
  local reply="${3:-}"
  require_prepared
  local token="$$-$(date +%s)"
  local runner="$desktop_worktree/p1-interop-${token}.mjs"
  local step="$run_dir/step-${mode}-${token}.mjs"
  local prefix="$run_dir/desktop-${mode}-$(date -u +%Y%m%dT%H%M%SZ)"
  local profile="$run_dir/electron-profile-${token}"
  local owner_nsec
  interop_runner_cleanup="$runner"
  interop_step_cleanup="$step"
  trap cleanup_interop_temps EXIT

  mkdir -p "$profile"
  ditto "$electron_profile_source" "$profile"
  chmod 700 "$profile"
  owner_nsec="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).nsec)' "$owner_file")"
  cp "$desktop_tools/p1-drive.mjs" "$runner"
  node --input-type=module - "$runner" "$run_dir/colony-native-host" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [runner, host] = process.argv.slice(2);
const source = readFileSync(runner, 'utf8');
const needle = '/Users/mac/worktrees/.lanes/bin/colony-native-host';
if (!source.includes(needle)) throw new Error('Unexpected p1-drive helper contract');
writeFileSync(runner, source.replace(needle, host));
NODE

  cat > "$step" <<'NODE'
export default async ({ page, shot }) => {
  const mode = process.env.COLONY_INTEROP_MODE;
  const message = process.env.COLONY_INTEROP_MESSAGE;
  const general = page.getByText('general', { exact: true }).first();
  try {
    await general.waitFor({ timeout: 45000 });
    await general.click();
  } catch (error) {
    console.error('ELECTRON_CHANNEL_NOT_READY:', (await page.locator('body').innerText()).slice(0, 900).replace(/\n+/g, ' | '));
    await shot('channel-not-ready');
    throw error;
  }
  await page.waitForTimeout(3500);
  if (mode === 'send') {
    const box = page.locator('[contenteditable="true"], textarea').first();
    await box.click();
    await page.keyboard.type(message);
    await page.keyboard.press('Enter');
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="message-send-status"]').length === 0,
      null,
      { timeout: 30000 },
    );
    await shot('desktop-to-mobile-sent');
    console.log('PASS desktop-to-mobile: Electron send settled');
    return;
  }
  if (mode === 'wait') {
    console.log('WAIT mobile-to-desktop for the supplied canary message');
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 120000 });
    await shot('mobile-to-desktop-live');
    console.log('PASS mobile-to-desktop: message arrived live in Electron');
    return;
  }
  if (mode === 'thread') {
    const rootRow = page.getByTestId('message-row').filter({ hasText: message });
    await rootRow.first().waitFor({ timeout: 45000 });
    if (await rootRow.count() !== 1) throw new Error('Could not identify one thread root row for the supplied message');
    const rootId = await rootRow.first().getAttribute('data-message-id');
    if (!/^[0-9a-f]{64}$/.test(rootId ?? '')) throw new Error('The matching thread root has no valid event id');
    const summary = page.locator(`[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`);
    await summary.waitFor({ timeout: 45000 });
    await summary.click();
    await page.getByText(message, { exact: true }).first().waitFor({ timeout: 20000 });
    await page.getByText(process.env.COLONY_INTEROP_REPLY, { exact: true }).first().waitFor({ timeout: 45000 });
    await page.waitForTimeout(1500);
    await shot('mobile-thread-reply-visible');
    console.log('PASS mobile-thread-reply: reply arrived in Electron thread');
    return;
  }
  throw new Error(`Unexpected interop mode: ${mode}`);
};
NODE

  COLONY_INTEROP_MODE="$mode" COLONY_INTEROP_MESSAGE="$message" \
    COLONY_INTEROP_REPLY="$reply" \
    COLONY_ELECTRON_BACKGROUND=1 P1_RELAY="$relay_root" \
    BUZZ_PRIVATE_KEY="$owner_nsec" BUZZ_SHARE_IDENTITY=1 \
    node "$runner" "$profile" "$prefix" "$step"
  unset owner_nsec
  printf 'DESKTOP_SCREENSHOTS=%s-*.png\n' "$prefix"
  if [[ "$mode" == 'send' ]]; then
    local relay_events=''
    local relay_match=''
    for attempt in 1 2 3 4 5; do
      if relay_events="$(node "$desktop_worktree/p1-read.tmp.mjs" "$owner_file" '[9]' 2>/dev/null)"; then
        relay_match="$(printf '%s\n' "$relay_events" | rg -F -- "\"$message\"" | rg -F -- "$expected_general" || true)"
        if [[ -n "$relay_match" ]]; then
          printf 'PASS relay-publish: %s\n' "$message"
          break
        fi
      fi
      if [[ "$attempt" -eq 5 ]]; then
        fail "Electron UI send did not appear in the canary relay read for #general: $message"
      fi
      sleep 2
    done
  fi
  trap - EXIT
  cleanup_interop_temps
  interop_runner_cleanup=''
  interop_step_cleanup=''
}

case "$action" in
  prepare)
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    cp "$native_host_source" "$run_dir/colony-native-host"
    chmod 700 "$run_dir/colony-native-host"
    mobile_build_args=(build ios --simulator --debug)
    if [[ -n "${COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME:-}" ]]; then
      COLONY_GOOGLE_REVERSED_CLIENT_ID="$COLONY_GOOGLE_IOS_DOGFOOD_URL_SCHEME" \
        "$repo_root/scripts/mobile-google-auth-xcconfig.sh" dogfood
    fi
    if [[ -n "${COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID:-}" ]]; then
      mobile_build_args+=(
        "--dart-define=COLONY_GOOGLE_IOS_CLIENT_ID=$COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID"
      )
    fi
    server_client_id="${COLONY_GOOGLE_SERVER_CLIENT_ID:-${COLONY_GOOGLE_WEB_CLIENT_ID:-}}"
    if [[ -n "$server_client_id" ]]; then
      mobile_build_args+=(
        "--dart-define=COLONY_GOOGLE_SERVER_CLIENT_ID=$server_client_id"
      )
    fi
    CARGO_BUILD_JOBS=4 flutter "${mobile_build_args[@]}"
    [[ -d "$app_path" ]] || fail "Flutter did not produce $app_path"
    bundle_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")"
    [[ "$bundle_id" == "$expected_mobile_bundle_id" ]] || fail "Unexpected mobile bundle id: $bundle_id"
    printf '%s\n' "$bundle_id" > "$run_dir/mobile-bundle-id"
    chmod 600 "$run_dir/mobile-bundle-id"
    xcrun simctl install "$simulator_id" "$app_path"
    xcrun simctl launch "$simulator_id" "$bundle_id"

    if [[ ! -s "$run_dir/invite.json" ]]; then
      (cd "$desktop_worktree" && OWNER_FILE="$owner_file" INVITE_OUT="$run_dir/invite.json" node --input-type=module <<'NODE'
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { finalizeEvent, nip19 } from 'nostr-tools';
const owner = JSON.parse(readFileSync(process.env.OWNER_FILE, 'utf8'));
if (owner.host !== 'p1e-mudsa14i.canary.colony.ainative.ventures' ||
    owner.pubkey !== 'e54a123a6c2c75b9210bd9be4e963572ab94e6397c7904aca7e24c932fd2665e') {
  throw new Error('Refusing to mint an invite for an unexpected owner or tenant');
}
const url = `https://${owner.host}/api/invites`;
const body = JSON.stringify({ ttl_secs: 3600, max_uses: 1 });
const payload = createHash('sha256').update(body).digest('hex');
const secretKey = nip19.decode(owner.nsec).data;
const authEvent = finalizeEvent({
  kind: 27235,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['u', url], ['method', 'POST'], ['payload', payload], ['nonce', randomUUID()]],
  content: '',
}, secretKey);
const response = await fetch(url, {
  method: 'POST',
  headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(authEvent)).toString('base64')}`, 'content-type': 'application/json' },
  body,
  signal: AbortSignal.timeout(15000),
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Invite mint failed: HTTP ${response.status} ${result.error ?? ''}`);
if (typeof result.code !== 'string' || !result.code.startsWith('v2.')) throw new Error('Relay returned an unexpected invite contract');
writeFileSync(process.env.INVITE_OUT, JSON.stringify({ relay: `wss://${owner.host}`, code: result.code, url: result.url, expires_at: result.expires_at }), { mode: 0o600 });
chmodSync(process.env.INVITE_OUT, 0o600);
console.log('Minted one-use, 60-minute invite via the existing canary owner endpoint.');
NODE
      )
    else
      printf '%s\n' 'Reusing the locally stored invite. Remove invite.json only when an unused replacement invite is needed.'
    fi

    deep_link="$(node -e 'const i=require(process.argv[1]); process.stdout.write(`buzz://join?relay=${encodeURIComponent(i.relay)}&code=${encodeURIComponent(i.code)}`)' "$run_dir/invite.json")"
    xcrun simctl openurl "$simulator_id" "$deep_link"
    printf 'IOS_SIMULATOR=%s\nRUN_DIR=%s\n' "$simulator_id" "$run_dir"
    printf '%s\n' 'Complete the Simulator prompts: Open Buzz, then tap Join on the canary invite preview.'
    ;;
  desktop-wait)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    [[ ${#2} -le 180 && "$2" != *$'\n'* ]] || fail 'Message must be one line and at most 180 characters.'
    launch_electron_step wait "$2"
    ;;
  desktop-send)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    [[ -n "$2" && ${#2} -le 180 && "$2" != *$'\n'* ]] || fail 'Message must be nonempty, one line, and at most 180 characters.'
    launch_electron_step send "$2"
    ;;
  desktop-thread)
    [[ $# -eq 3 ]] || { usage >&2; exit 2; }
    [[ -n "$2" && ${#2} -le 180 && "$2" != *$'\n'* ]] || fail 'Root message must be nonempty, one line, and at most 180 characters.'
    [[ -n "$3" && ${#3} -le 180 && "$3" != *$'\n'* ]] || fail 'Reply message must be nonempty, one line, and at most 180 characters.'
    launch_electron_step thread "$2" "$3"
    ;;
  mobile-screenshot)
    [[ $# -le 2 ]] || { usage >&2; exit 2; }
    capture_mobile "${2:-current}"
    ;;
  mobile-relaunch)
    require_prepared
    bundle_id="$(cat "$run_dir/mobile-bundle-id")"
    xcrun simctl terminate "$simulator_id" "$bundle_id"
    xcrun simctl launch "$simulator_id" "$bundle_id"
    sleep "${COLONY_MOBILE_SETTLE_SECONDS:-8}"
    capture_mobile relaunch
    ;;
  mobile-background)
    require_prepared
    bundle_id="$(cat "$run_dir/mobile-bundle-id")"
    xcrun simctl launch "$simulator_id" com.apple.Preferences
    sleep "${COLONY_MOBILE_BACKGROUND_SECONDS:-8}"
    xcrun simctl launch "$simulator_id" "$bundle_id"
    sleep "${COLONY_MOBILE_SETTLE_SECONDS:-8}"
    capture_mobile foreground
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
