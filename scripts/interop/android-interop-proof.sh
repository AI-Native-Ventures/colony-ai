#!/usr/bin/env bash
set -euo pipefail

package="${ANDROID_PACKAGE:-xyz.block.buzz.mobile}"
activity="${ANDROID_ACTIVITY:-${package}/.MainActivity}"
apk_path="${APK_PATH:-mobile/build/app/outputs/flutter-apk/app-debug.apk}"
artifact_dir="${ANDROID_INTEROP_ARTIFACT_DIR:-android-interop-artifacts}"
peer_dir="${ANDROID_INTEROP_PEER_DIR:?ANDROID_INTEROP_PEER_DIR is required}"
peer_script="$peer_dir/android-interop-peer.mjs"
invite_file="${ANDROID_INTEROP_INVITE_PATH:?ANDROID_INTEROP_INVITE_PATH is required}"
ui_script="scripts/interop/android-interop-ui.py"
run_id="${GITHUB_RUN_ID:-local}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
serial=""
peer_watch_pid=""
max_screenshot_bytes=$((20 * 1024 * 1024))

mkdir -p "$artifact_dir"
exec > >(tee "$artifact_dir/harness.log") 2>&1

collect_runtime_diagnostics() {
  local label="$1"
  local screen_path="$artifact_dir/screen-${label}.png"
  local logcat_path="$artifact_dir/android-logcat-${label}.txt"
  local relay_error_path="$artifact_dir/relay-errors-${label}.log"
  local screen_state=unavailable
  local logcat_bytes=0
  local relay_error_bytes=0

  if [[ -n "$serial" ]]; then
    timeout --preserve-status 15s adb -s "$serial" exec-out screencap -p \
      > "$screen_path" 2>&1 || true
    if [[ -s "$screen_path" ]]; then
      local screenshot_bytes
      screenshot_bytes="$(stat -c '%s' "$screen_path")"
      if ((screenshot_bytes <= max_screenshot_bytes)); then
        screen_state=captured
      else
        rm -f "$screen_path"
      fi
    fi
    timeout --preserve-status 15s adb -s "$serial" logcat -d -v time -t 2000 \
      -s flutter:E AndroidRuntime:E System.err:E 2>&1 |
      head -c 1048576 > "$logcat_path" || true
    logcat_bytes="$(wc -c < "$logcat_path" 2>/dev/null || echo 0)"
  fi

  if [[ -s /tmp/buzz-relay.log ]]; then
    awk 'length($0) <= 4096 && /WARN|ERROR/' /tmp/buzz-relay.log |
      tail -n 200 | head -c 524288 > "$relay_error_path" || true
    relay_error_bytes="$(wc -c < "$relay_error_path")"
  fi
  echo "DIAGNOSTICS screen=$screen_state logcat_bytes=$logcat_bytes relay_error_bytes=$relay_error_bytes"
}

fail() {
  echo "FAIL $*" >&2
  collect_runtime_diagnostics failure
  exit 1
}

cleanup() {
  if [[ -n "$peer_watch_pid" ]] && kill -0 "$peer_watch_pid" 2>/dev/null; then
    kill -TERM "$peer_watch_pid" 2>/dev/null || true
    wait "$peer_watch_pid" 2>/dev/null || true
  fi
  if [[ -s /tmp/buzz-relay.pid ]]; then
    relay_pid="$(cat /tmp/buzz-relay.pid)"
    kill -TERM "$relay_pid" 2>/dev/null || true
  fi
  if [[ -n "$serial" ]]; then
    timeout --preserve-status 25s adb -s "$serial" shell am force-stop "$package" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

[[ -s "$apk_path" ]] || fail "debug APK is missing: $apk_path"
[[ -s "$invite_file" ]] || fail "seeded-community invite is missing"
[[ -f "$peer_script" ]] || fail "nostr-tools peer script is missing"

mapfile -t emulators < <(
  timeout --preserve-status 25s adb devices |
    awk 'NR > 1 && $2 == "device" && $1 ~ /^emulator-/ { print $1 }'
)
if [[ "${#emulators[@]}" -ne 1 ]]; then
  timeout --preserve-status 25s adb devices || true
  fail "expected exactly one online Android emulator, found ${#emulators[@]}"
fi
serial="${emulators[0]}"
adb_target() {
  timeout --preserve-status 25s adb -s "$serial" "$@"
}

ui() {
  python3 "$ui_script" "$@"
}

capture() {
  label="$1"
  foreground="$(adb_target shell dumpsys window windows | tr -d '\r')"
  if ! printf '%s\n' "$foreground" |
    python3 scripts/android-runtime-proof-parser.py foreground --package "$package" >/dev/null; then
    fail "app is not foreground before $label screenshot"
  fi
  adb_target exec-out screencap -p > "$artifact_dir/${label}.png"
  test -s "$artifact_dir/${label}.png" || fail "screenshot is empty: $label"
  screenshot_bytes="$(stat -c '%s' "$artifact_dir/${label}.png")"
  ((screenshot_bytes <= max_screenshot_bytes)) ||
    fail "screenshot exceeds ${max_screenshot_bytes} bytes: $label"
  python3 "$ui_script" dump >/dev/null
  cp "$artifact_dir/ui-current.xml" "$artifact_dir/${label}.xml"
  echo "SCREENSHOT $label"
}

wait_text() {
  ui wait-text "$1" --timeout "${2:-120}"
}

wait_exact() {
  ui wait-text "$1" --exact --timeout "${2:-120}"
}

tap_exact() {
  ui tap-text "$1" --exact --timeout "${2:-30}"
}

tap_text() {
  ui tap-text "$1" --timeout "${2:-30}"
}

type_text() {
  local value="$1"
  local offset=0
  local chunk
  # The first text event can race Android's IME startup after the input tap.
  sleep 1
  while ((offset < ${#value})); do
    chunk="${value:offset:1}"
    adb_target shell input text "$chunk"
    offset=$((offset + ${#chunk}))
    sleep 0.25
  done
  ui wait-input-value "$value" --timeout 35
}

launch_deeplink() {
  local link="$1"
  local launch_output
  local remote_link remote_activity safe_launch_output
  # adb shell builds a remote shell command. Keep the URI's query separators
  # inside the -d argument instead of letting the remote shell treat '&' as a
  # background operator.
  printf -v remote_link '%q' "$link"
  printf -v remote_activity '%q' "$activity"
  launch_output="$(adb_target shell \
    "am start -a android.intent.action.VIEW -d $remote_link -n $remote_activity" \
    2>&1 | tr -d '\r')" || {
      safe_launch_output="$(printf '%s' "$launch_output" | sed -E 's/(code=)[^& }]+/\1[redacted]/g')"
      fail "Android app did not accept the test deep link: $safe_launch_output"
    }
  if [[ "$launch_output" != *"Starting: Intent"* &&
    "$launch_output" != *"Warning: Activity not started, intent has been delivered"* ]]; then
    safe_launch_output="$(printf '%s' "$launch_output" | sed -E 's/(code=)[^& }]+/\1[redacted]/g')"
    fail "Android did not report a started deep-link activity: $safe_launch_output"
  fi
}

start_relay_process() {
  local profile="${CARGO_PROFILE:-ci}"
  local relay_binary="./target/${profile}/buzz-relay"
  local relay_pid

  [[ -x "$relay_binary" ]] || fail "built relay binary is missing: $relay_binary"
  : "${BUZZ_RELAY_PRIVATE_KEY:?BUZZ_RELAY_PRIVATE_KEY is required to restart the relay}"
  nohup env \
    DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz \
    REDIS_URL=redis://localhost:6379 \
    RELAY_URL=ws://localhost:3000 \
    BUZZ_BIND_ADDR=0.0.0.0:3000 \
    BUZZ_RELAY_PRIVATE_KEY="$BUZZ_RELAY_PRIVATE_KEY" \
    BUZZ_REQUIRE_AUTH_TOKEN=false \
    BUZZ_RECONCILE_CHANNELS=true \
    BUZZ_GIT_PROBE_WRITERS=8 \
    "$relay_binary" > /tmp/buzz-relay.log 2>&1 &
  echo $! > /tmp/buzz-relay.pid
  relay_pid="$(cat /tmp/buzz-relay.pid)"

  for _ in $(seq 1 60); do
    if ! kill -0 "$relay_pid" 2>/dev/null; then
      cat /tmp/buzz-relay.log
      fail "relay process exited during restart"
    fi
    if curl --silent --show-error --fail http://127.0.0.1:3000/_readiness >/dev/null 2>&1; then
      echo "PASS relay-restarted profile=$profile"
      return
    fi
    sleep 1
  done

  cat /tmp/buzz-relay.log
  fail "restarted relay did not become ready within 60s"
}

echo "Android hosted relay interop proof"
echo "source_sha=${SOURCE_SHA:-${GITHUB_SHA:-unknown}}"
echo "run_id=$run_id attempt=$run_attempt"
echo "device=$serial"
echo "package=$package"
echo "apk_sha256=$(sha256sum "$apk_path" | awk '{print $1}')"

if adb_target shell pm list packages | tr -d '\r' | grep -Fxq "package:$package"; then
  adb_target uninstall "$package"
fi
adb_target install "$apk_path"
adb_target shell pm path "$package" >/dev/null
clear_result="$(adb_target shell pm clear "$package" | tr -d '\r\n')"
[[ "$clear_result" == *Success* ]] || fail "could not clear app data: $clear_result"
adb_target reverse tcp:3000 tcp:3000

{
  echo "device_model=$(adb_target shell getprop ro.product.model | tr -d '\r\n')"
  echo "android_release=$(adb_target shell getprop ro.build.version.release | tr -d '\r\n')"
  echo "android_api=$(adb_target shell getprop ro.build.version.sdk | tr -d '\r\n')"
  echo "android_abi=$(adb_target shell getprop ro.product.cpu.abi | tr -d '\r\n')"
  echo "screen=$(adb_target shell wm size | tr -d '\r\n')"
  echo "density=$(adb_target shell wm density | tr -d '\r\n')"
  echo "relay_forward=localhost:3000"
  echo "profile=fresh"
} > "$artifact_dir/metadata.txt"

invite_link="$(node "$peer_script" invite-link --input "$invite_file")"
launch_deeplink "$invite_link"
wait_text 'Join this Buzz community?' 120
capture invite-confirmation
tap_exact 'Join' 30
join_state="$(ui wait-either-text 'Continue to #welcome-everyone' 'Retry setup' --timeout 180)" ||
  fail "invite join did not reach the community or its recovery action"
echo "PASS ui-state-found value=$join_state"
if [[ "$join_state" == 'Retry setup' ]]; then
  capture starter-setup-retry-needed
  collect_runtime_diagnostics starter-setup-retry
  tap_exact 'Retry setup' 30
  join_state="$(ui wait-either-text 'Continue to #welcome-everyone' 'Retry setup' --timeout 120)" ||
    fail "invite starter setup retry did not reach the community or its recovery action"
  echo "PASS ui-state-found value=$join_state"
  [[ "$join_state" == 'Continue to #welcome-everyone' ]] ||
    fail "starter channel setup still requires retry after one recovery attempt"
  echo "PASS invite-starter-setup-recovered-after-retry"
fi
capture joined-community
tap_exact 'Continue to #welcome-everyone' 30
ui wait-input --timeout 180
capture welcome-channel

channel_id="$(node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).channelId)' "$invite_file")"
[[ "$channel_id" =~ ^[0-9a-f-]{36}$ ]] || fail "invite channel id is invalid"
peer_pubkey="$(node "$peer_script" pubkey)"
[[ "$peer_pubkey" =~ ^[0-9a-f]{64}$ ]] || fail "desktop peer public key is invalid"
events_file="$artifact_dir/peer-events.jsonl"
peer_log="$artifact_dir/peer-watch.log"
node "$peer_script" watch --channel "$channel_id" --events "$events_file" > "$peer_log" 2>&1 &
peer_watch_pid=$!
node "$peer_script" wait-ready --events "$events_file" --count 1 --timeout 45

peer_root="peerroot${run_id}a${run_attempt}"
peer_root_result="$artifact_dir/peer-root.json"
node "$peer_script" publish \
  --channel "$channel_id" --content "$peer_root" --result "$peer_root_result"
wait_text "$peer_root" 45
capture peer-message-rendered
root_id="$(node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).id)' "$peer_root_result")"
[[ "$root_id" =~ ^[0-9a-f]{64}$ ]] || fail "peer root event id is invalid"

android_message="androidmsg${run_id}a${run_attempt}"
ui tap-input --timeout 30
type_text "$android_message"
ui tap-send
node "$peer_script" wait-event \
  --events "$events_file" --channel "$channel_id" \
  --content "$android_message" --exclude-pubkey "$peer_pubkey" --timeout 45
wait_text "$android_message" 45
capture android-message-relayed

# A tap on a channel message opens its thread. The reply is sent through the
# Android thread composer and is checked for both Buzz/NIP-10 markers.
tap_text "$peer_root" 30
ui wait-input --timeout 45
android_reply="androidreply${run_id}a${run_attempt}"
ui tap-input --timeout 30
type_text "$android_reply"
ui tap-send
node "$peer_script" wait-event \
  --events "$events_file" --channel "$channel_id" \
  --content "$android_reply" --reply-root "$root_id" \
  --exclude-pubkey "$peer_pubkey" --timeout 45
wait_text "$android_reply" 45
capture android-thread-reply

# Relaunch through the real channel deep link so the fresh process must restore
# the joined identity and fetch its previous timeline from the relay.
adb_target shell am force-stop "$package"
channel_link="$(node "$peer_script" channel-link --input "$invite_file")"
launch_deeplink "$channel_link"
wait_text "$peer_root" 120
wait_text "$android_message" 45
capture history-after-relaunch
tap_text "$peer_root" 30
wait_text "$android_reply" 60
capture thread-history-after-relaunch

# Return to the channel timeline, then stop and restart the disposable relay.
# This forces the live Android WebSocket through a real disconnect/reconnect.
launch_deeplink "$channel_link"
ui wait-input --timeout 60
relay_pid_file=/tmp/buzz-relay.pid
[[ -s "$relay_pid_file" ]] || fail "relay PID file is missing before outage"
relay_pid="$(cat "$relay_pid_file")"
kill -TERM "$relay_pid"
relay_down=false
for _ in $(seq 1 30); do
  if ! curl --silent --show-error --fail http://127.0.0.1:3000/_readiness >/dev/null 2>&1; then
    relay_down=true
    break
  fi
  sleep 1
done
if [[ "$relay_down" != true ]]; then
  kill -KILL "$relay_pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    if ! curl --silent --show-error --fail http://127.0.0.1:3000/_readiness >/dev/null 2>&1; then
      relay_down=true
      break
    fi
    sleep 1
  done
fi
[[ "$relay_down" == true ]] || fail "relay readiness stayed up after termination"
echo "PASS relay-outage confirmed"

relay_stopped=false
for _ in $(seq 1 30); do
  if ! kill -0 "$relay_pid" 2>/dev/null; then
    relay_stopped=true
    break
  fi
  sleep 1
done
[[ "$relay_stopped" == true ]] || fail "relay process stayed alive after termination"
echo "PASS relay-process-stopped"

# The schema and seed are already in place. Restart only the relay process so
# this outage test does not reapply pgschema to populated partition tables.
start_relay_process
node "$peer_script" wait-ready --events "$events_file" --count 2 --timeout 90
reconnected_message="reconnected${run_id}a${run_attempt}"
node "$peer_script" publish --channel "$channel_id" --content "$reconnected_message"
wait_text "$reconnected_message" 90
node "$peer_script" wait-event \
  --events "$events_file" --channel "$channel_id" \
  --content "$reconnected_message" --timeout 45
capture android-after-relay-reconnect

{
  echo "invite_join=passed"
  echo "peer_to_android=passed"
  echo "android_to_relay=passed"
  echo "android_thread_reply=passed root=$root_id"
  echo "force_stop_relaunch_history=passed"
  echo "relay_outage_reconnect=passed"
  echo "channel_id=$channel_id"
} > "$artifact_dir/proof.txt"
echo "PASS Android relay interoperability proof"
