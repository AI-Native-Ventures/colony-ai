#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_root="$repo_root/mobile"
ios_root="$mobile_root/ios"
override_path="$ios_root/Flutter/AppOverrides.xcconfig"
worktree_override_path="$ios_root/Flutter/WorktreeOverrides.xcconfig"

run_id="${GITHUB_RUN_ID:-}"
run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
if [[ ! "$run_id" =~ ^[0-9]+$ || ! "$run_attempt" =~ ^[0-9]+$ ]]; then
  printf 'iOS runtime proof requires numeric GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT\n' >&2
  exit 2
fi

app_bundle_id="ventures.ainative.colony.dogfood.ci.r${run_id}a${run_attempt}"
if [[ ! "$app_bundle_id" =~ ^ventures\.ainative\.colony\.dogfood\.ci\.r[0-9]+a[0-9]+$ ]]; then
  printf 'invalid generated app bundle identifier\n' >&2
  exit 2
fi

run_root="${IOS_RUNTIME_RUN_ROOT:-${RUNNER_TEMP:-$repo_root}/buzz-ios-runtime-proof-${run_id}-${run_attempt}}"
derived_data="$run_root/derived-data"
result_bundle="$run_root/RunnerUITests.xcresult"
attachments_dir="$run_root/attachments"
manifest_path="$run_root/ios-runtime-manifest.json"
mkdir -p "$run_root"

sim_udid=""
sim_created=0
override_created=0

log() {
  printf '[ios-runtime] %s\n' "$*"
}

fail() {
  printf '[ios-runtime] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  set +e
  if [[ "$override_created" == "1" ]]; then
    rm -f -- "$override_path"
  fi
  if [[ "$sim_created" == "1" && -n "$sim_udid" ]]; then
    xcrun simctl shutdown "$sim_udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$sim_udid" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

run_logged() {
  local log_path="$1"
  shift
  if ! "$@" >"$log_path" 2>&1; then
    tail -n 80 "$log_path" >&2 || true
    return 1
  fi
}

run_in_dir() {
  local directory="$1"
  shift
  (cd "$directory" && "$@")
}

[[ "$(uname -s)" == "Darwin" ]] || fail "hosted proof requires macOS"
command -v xcrun >/dev/null || fail "xcrun is unavailable"
command -v xcodebuild >/dev/null || fail "xcodebuild is unavailable"
command -v flutter >/dev/null || fail "Flutter is unavailable"
command -v pod >/dev/null || fail "CocoaPods is unavailable"
command -v python3 >/dev/null || fail "python3 is unavailable"

[[ ! -e "$override_path" && ! -L "$override_path" ]] || \
  fail "refusing pre-existing AppOverrides.xcconfig"
[[ ! -e "$worktree_override_path" && ! -L "$worktree_override_path" ]] || \
  fail "refusing pre-existing WorktreeOverrides.xcconfig"

unset BUZZ_RELAY_URL BUZZ_PRIVATE_KEY BUZZ_AUTH_TAG BUZZ_PUSH_GATEWAY_URL

google_reversed_client_id="${COLONY_GOOGLE_REVERSED_CLIENT_ID:-}"
if [[ -n "$google_reversed_client_id" &&
  ( ! "$google_reversed_client_id" =~ ^[A-Za-z0-9.-]+$ ||
    ${#google_reversed_client_id} -gt 512 ) ]]; then
  fail "COLONY_GOOGLE_REVERSED_CLIENT_ID must be a URL scheme"
fi

log "collecting toolchain and simulator inventory"
xcodebuild -version >"$run_root/xcode-version.txt"
xcrun simctl list runtimes available -j >"$run_root/runtimes.json"
xcrun simctl list devicetypes -j >"$run_root/device-types.json"
flutter --version >"$run_root/flutter-version.txt" 2>&1
pod --version >"$run_root/cocoapods-version.txt"

runtime_selection="$(python3 - "$run_root/runtimes.json" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

candidates = []
for runtime in data.get("runtimes", []):
    if runtime.get("platform") != "iOS" or not runtime.get("isAvailable"):
        continue
    version = str(runtime.get("version", ""))
    match = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", version)
    if not match or int(match.group(1)) < 16:
        continue
    parsed = tuple(int(part or 0) for part in match.groups())
    candidates.append((parsed, runtime.get("identifier", ""), version))

if not candidates:
    raise SystemExit("no available iOS 16+ simulator runtime")

_, identifier, version = max(candidates)
print(f"{identifier}\t{version}")
PY
)" || fail "no available iOS 16+ simulator runtime"
IFS=$'\t' read -r runtime_id runtime_version <<<"$runtime_selection"
[[ -n "$runtime_id" && -n "$runtime_version" ]] || fail "runtime inventory was incomplete"

device_selection="$(python3 - "$run_root/device-types.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

candidates = [
    item for item in data.get("devicetypes", [])
    if item.get("name", "").startswith("iPhone") and item.get("identifier")
]
if not candidates:
    raise SystemExit("no iPhone simulator device type")
candidates.sort(key=lambda item: (item["name"], item["identifier"]))
print(f"{candidates[0]['identifier']}\t{candidates[0]['name']}")
PY
)" || fail "no iPhone simulator device type"
IFS=$'\t' read -r device_type_id device_type_name <<<"$device_selection"
[[ -n "$device_type_id" && -n "$device_type_name" ]] || fail "device inventory was incomplete"

sim_name="buzz-ios-runtime-${run_id}-${run_attempt}"
xcrun simctl list devices available -j >"$run_root/devices-before.json"
python3 - "$run_root/devices-before.json" "$sim_name" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
name = sys.argv[2]
for devices in data.get("devices", {}).values():
    if any(device.get("name") == name for device in devices):
        raise SystemExit("simulator name already exists")
PY

log "creating fresh simulator runtime=$runtime_version device=$device_type_name"
sim_udid="$(xcrun simctl create "$sim_name" "$device_type_id" "$runtime_id")" || \
  fail "simulator creation failed"
[[ "$sim_udid" =~ ^[0-9A-Fa-f-]{36}$ ]] || fail "simulator creation returned an invalid UUID"
sim_created=1
xcrun simctl boot "$sim_udid" >/dev/null
xcrun simctl bootstatus "$sim_udid" -b >/dev/null

printf '%s\n' \
  '// Generated for one hosted iOS runtime proof; removed by the trap.' \
  "BUNDLE_IDENTIFIER = $app_bundle_id" \
  >"$override_path"
override_created=1
if [[ -n "$google_reversed_client_id" ]]; then
  printf 'COLONY_GOOGLE_REVERSED_CLIENT_ID = %s\n' \
    "$google_reversed_client_id" >>"$override_path"
fi

log "installing Flutter dependencies and generating the simulator app"
run_logged "$run_root/flutter-pub-get.log" run_in_dir "$mobile_root" flutter pub get
flutter_build_args=(
  build ios --simulator --debug --no-pub
  --dart-define=BUZZ_AGE_GATING_ENABLED=false
)
if [[ -n "${COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID:-}" ]]; then
  flutter_build_args+=(
    "--dart-define=COLONY_GOOGLE_IOS_CLIENT_ID=$COLONY_GOOGLE_IOS_DOGFOOD_CLIENT_ID"
  )
fi
if [[ -n "${COLONY_GOOGLE_SERVER_CLIENT_ID:-}" ]]; then
  flutter_build_args+=(
    "--dart-define=COLONY_GOOGLE_SERVER_CLIENT_ID=$COLONY_GOOGLE_SERVER_CLIENT_ID"
  )
fi
run_logged "$run_root/flutter-build.log" run_in_dir "$mobile_root" \
  flutter "${flutter_build_args[@]}"
run_logged "$run_root/pod-install.log" run_in_dir "$ios_root" pod install --deployment

mkdir -p "$derived_data"
build_args=(
  xcodebuild
  -workspace Runner.xcworkspace
  -scheme Runner
  -configuration Debug
  -destination "platform=iOS Simulator,id=$sim_udid"
  -derivedDataPath "$derived_data"
  "BUNDLE_IDENTIFIER=$app_bundle_id"
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  build-for-testing
)
log "building the app and UI-test bundle for testing"
run_logged "$run_root/xcodebuild-build-for-testing.log" run_in_dir "$ios_root" \
  "${build_args[@]}"

app_path="$(python3 - "$derived_data" "$app_bundle_id" <<'PY'
import plistlib
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
expected = sys.argv[2]
matches = []
for candidate in root.rglob("*.app"):
    if candidate.is_symlink() or not candidate.is_dir():
        continue
    plist_path = candidate / "Info.plist"
    try:
        with plist_path.open("rb") as handle:
            info = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException, ValueError):
        continue
    if info.get("CFBundleIdentifier") == expected:
        matches.append(candidate)
if len(matches) != 1:
    raise SystemExit(f"expected one app with the verified bundle id, found {len(matches)}")
print(matches[0])
PY
)" || fail "could not locate exactly one verified Buzz.app"
case "$app_path" in
  "$derived_data"/*) ;;
  *) fail "app path escaped derived data" ;;
esac
[[ -d "$app_path" && ! -L "$app_path" ]] || fail "verified app path is not a real directory"

read_plist_value() {
  local key="$1"
  local plist_path="$2"
  plutil -extract "$key" raw -o - "$plist_path"
}

actual_app_id="$(read_plist_value CFBundleIdentifier "$app_path/Info.plist")"
actual_executable="$(read_plist_value CFBundleExecutable "$app_path/Info.plist")"
actual_version="$(read_plist_value CFBundleShortVersionString "$app_path/Info.plist")"
[[ "$actual_app_id" == "$app_bundle_id" ]] || fail "app CFBundleIdentifier mismatch"
[[ -n "$actual_executable" && -n "$actual_version" ]] || fail "app metadata is incomplete"
[[ "$actual_app_id" != "ventures.ainative.colony" ]] || fail "release app identifier was selected"

extension_id=""
extension_plist="$app_path/PlugIns/NotificationService.appex/Info.plist"
if [[ -f "$extension_plist" ]]; then
  extension_id="$(read_plist_value CFBundleIdentifier "$extension_plist")"
  [[ "$extension_id" == "$app_bundle_id.NotificationService" ]] || \
    fail "notification extension identifier mismatch"
fi

app_sha256="$(ditto -c -k --sequesterRsrc --keepParent "$app_path" - | \
  shasum -a 256 | awk '{print $1}')"
[[ "$app_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "app hash was not produced"

log "installing and verifying the exact app package"
xcrun simctl install "$sim_udid" "$app_path" >/dev/null
installed_apps_plist="$run_root/installed-apps.plist"
installed_apps_xml="$run_root/installed-apps.xml"
xcrun simctl listapps "$sim_udid" >"$installed_apps_plist"
plutil -convert xml1 -o "$installed_apps_xml" "$installed_apps_plist"
python3 - "$installed_apps_xml" "$app_bundle_id" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as handle:
    installed = plistlib.load(handle)
if sys.argv[2] not in installed:
    raise SystemExit("verified app bundle is not installed on the owned simulator")
PY

test_bundle_info="$(python3 - "$derived_data" "$app_bundle_id" <<'PY'
import plistlib
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
expected_app = sys.argv[2]
matches = []
for candidate in root.rglob("*.xctest"):
    if candidate.is_symlink() or not candidate.is_dir():
        continue
    plist_path = candidate / "Info.plist"
    try:
        with plist_path.open("rb") as handle:
            info = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException, ValueError):
        continue
    if info.get("TestAppBundleIdentifier") == expected_app:
        matches.append((candidate, info))
if len(matches) != 1:
    raise SystemExit(f"expected one UI-test bundle bound to the verified app, found {len(matches)}")
candidate, info = matches[0]
test_id = info.get("CFBundleIdentifier", "")
if test_id != expected_app + ".RunnerUITests":
    raise SystemExit("UI-test bundle identifier does not derive from the app identifier")
print(f"{test_id}\t{candidate}")
PY
)" || fail "could not verify the UI-test bundle binding"
IFS=$'\t' read -r test_bundle_id test_bundle_path <<<"$test_bundle_info"

test_args=(
  xcodebuild
  -workspace Runner.xcworkspace
  -scheme Runner
  -configuration Debug
  -destination "platform=iOS Simulator,id=$sim_udid"
  -derivedDataPath "$derived_data"
  -only-testing:RunnerUITests
  -resultBundlePath "$result_bundle"
  "BUNDLE_IDENTIFIER=$app_bundle_id"
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  test-without-building
)
log "running XCTest landing and relaunch proof"
test_failed=0
if ! run_logged "$run_root/xcodebuild-test-without-building.log" run_in_dir "$ios_root" \
  "${test_args[@]}"; then
  test_failed=1
  log "XCTest proof failed; exporting available evidence before exiting"
fi

mkdir -p "$attachments_dir"
if [[ -d "$result_bundle" ]]; then
  run_logged "$run_root/xcresulttool-export.log" \
    xcrun xcresulttool export attachments --path "$result_bundle" --output-path "$attachments_dir" || \
    log "WARNING: attachment export failed; see xcresulttool log"
else
  log "WARNING: no result bundle; skipping attachment export"
fi

if [[ "$test_failed" == "1" ]]; then
  fail "XCTest landing and relaunch proof failed"
fi

screenshot_hashes_json="$(python3 - "$attachments_dir" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = sorted(path for path in root.rglob("*.png") if path.is_file() and not path.is_symlink())
if len(files) < 2:
    raise SystemExit(f"expected two assertion screenshots, found {len(files)}")
result = []
for path in files:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    result.append({"name": path.name, "sha256": digest})
print(json.dumps(result, separators=(",", ":")))
PY
)" || fail "assertion-tied screenshots were not exported"

source_revision="$(git -C "$repo_root" rev-parse HEAD)"
export app_bundle_id actual_app_id actual_executable actual_version extension_id app_sha256 \
  test_bundle_id runtime_id runtime_version device_type_id device_type_name sim_udid \
  source_revision screenshot_hashes_json run_id run_attempt
python3 - "$manifest_path" <<'PY'
import json
import os
import pathlib
import sys

manifest = {
    "sourceRevision": os.environ["source_revision"],
    "run": {
        "id": os.environ["run_id"],
        "attempt": os.environ["run_attempt"],
    },
    "simulator": {
        "udid": os.environ["sim_udid"],
        "runtime": os.environ["runtime_id"],
        "runtimeVersion": os.environ["runtime_version"],
        "deviceType": os.environ["device_type_id"],
        "deviceName": os.environ["device_type_name"],
    },
    "package": {
        "appBundleIdentifier": os.environ["actual_app_id"],
        "uiTestBundleIdentifier": os.environ["test_bundle_id"],
        "executable": os.environ["actual_executable"],
        "version": os.environ["actual_version"],
        "notificationExtensionIdentifier": os.environ["extension_id"],
        "appSha256": os.environ["app_sha256"],
    },
    "proof": {
        "build": "build-for-testing",
        "test": "test-without-building",
        "ageGating": "disabled",
        "initial": "landing_ok",
        "relaunch": "landing_ok",
        "screenshots": json.loads(os.environ["screenshot_hashes_json"]),
    },
}
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

log "iOS runtime proof passed; manifest=$manifest_path"
