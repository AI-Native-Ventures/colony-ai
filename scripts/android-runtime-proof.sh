#!/usr/bin/env bash
# Prove the existing Flutter Android APK can run on one disposable emulator.
# This deliberately does not configure a relay, account, auth, or pairing
# state; those are later interoperability gates.
set -euo pipefail

package="${ANDROID_PACKAGE:-xyz.block.buzz.mobile}"
activity="${ANDROID_ACTIVITY:-${package}/.MainActivity}"
apk_path="${APK_PATH:-mobile/build/app/outputs/flutter-apk/app-debug.apk}"
output_dir="${ANDROID_RUNTIME_ARTIFACT_DIR:-android-runtime-artifacts}"
source_sha="${SOURCE_SHA:-${GITHUB_SHA:-unknown}}"
ui_timeout_seconds="${ANDROID_RUNTIME_UI_TIMEOUT_SECONDS:-90}"
adb_timeout_seconds="${ANDROID_RUNTIME_ADB_TIMEOUT_SECONDS:-20}"
install_timeout_seconds="${ANDROID_RUNTIME_INSTALL_TIMEOUT_SECONDS:-60}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
parser_path="${ANDROID_RUNTIME_PARSER:-$script_dir/android-runtime-proof-parser.py}"

mkdir -p "$output_dir"
exec > >(tee "$output_dir/harness.log") 2>&1

die() {
    echo "::error::$*" >&2
    exit 1
}

[[ "$package" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]] ||
    die "ANDROID_PACKAGE is not a valid application id"
[[ -f "$parser_path" ]] || die "Android runtime parser is missing: $parser_path"
command -v python3 >/dev/null 2>&1 || die "python3 is not available"
python3 "$parser_path" component --package "$package" --component "$activity" ||
    die "ANDROID_ACTIVITY does not belong to ANDROID_PACKAGE"
[[ -s "$apk_path" ]] || die "APK does not exist or is empty: $apk_path"
command -v adb >/dev/null 2>&1 || die "adb is not available"
command -v timeout >/dev/null 2>&1 || die "timeout is not available"

adb_bounded() {
    timeout --preserve-status "${adb_timeout_seconds}s" adb "$@"
}

mapfile -t online_emulators < <(
    adb_bounded devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1 }'
)
if [[ "${#online_emulators[@]}" -ne 1 ]]; then
    adb_bounded devices || true
    die "expected exactly one online emulator, found ${#online_emulators[@]}"
fi
serial="${online_emulators[0]}"
[[ "$(adb_bounded -s "$serial" get-state | tr -d '\r\n')" == "device" ]] ||
    die "emulator $serial is not ready"

adb_target() {
    adb_bounded -s "$serial" "$@"
}

adb_install() {
    timeout --preserve-status "${install_timeout_seconds}s" adb "$@"
}

cleanup() {
    adb_target shell am force-stop "$package" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Android emulator runtime proof"
echo "serial=$serial"
echo "package=$package"
echo "activity=$activity"
echo "source_sha=$source_sha"

if adb_target shell pm list packages | tr -d '\r' | grep -Fxq "package:$package"; then
    echo "Removing pre-existing package to guarantee a fresh profile"
    adb_target uninstall "$package"
fi

echo "Installing $apk_path"
adb_install -s "$serial" install "$apk_path"
adb_target shell pm path "$package" >/dev/null
clear_result="$(adb_target shell pm clear "$package" | tr -d '\r\n')"
[[ "$clear_result" == *Success* ]] || die "failed to clear fresh app data: $clear_result"

apk_sha256="$(sha256sum "$apk_path" | awk '{ print $1 }')"
{
    echo "proof=Android emulator runtime"
    echo "source_sha=$source_sha"
    echo "github_run_id=${GITHUB_RUN_ID:-unknown}"
    echo "runner_os=${RUNNER_OS:-unknown}"
    echo "runner_name=${RUNNER_NAME:-unknown}"
    echo "device_serial=$serial"
    echo "device_model=$(adb_target shell getprop ro.product.model | tr -d '\r\n')"
    echo "device_name=$(adb_target shell getprop ro.product.name | tr -d '\r\n')"
    echo "android_release=$(adb_target shell getprop ro.build.version.release | tr -d '\r\n')"
    echo "android_api=$(adb_target shell getprop ro.build.version.sdk | tr -d '\r\n')"
    echo "android_abi=$(adb_target shell getprop ro.product.cpu.abi | tr -d '\r\n')"
    echo "android_abis=$(adb_target shell getprop ro.product.cpu.abilist | tr -d '\r\n')"
    echo "screen=$(adb_target shell wm size | tr -d '\r\n')"
    echo "package=$package"
    echo "activity=$activity"
    echo "apk_signing=debug-signed"
    echo "apk_path=$apk_path"
    echo "apk_sha256=$apk_sha256"
    echo "installed_path=$(adb_target shell pm path "$package" | tr -d '\r\n')"
    echo "--- package metadata ---"
    adb_target shell dumpsys package "$package" |
        tr -d '\r' |
        sed -nE '/versionCode=|versionName=|targetSdk=|minSdk=|firstInstallTime=|lastUpdateTime=/p'
} > "$output_dir/metadata.txt"

dump_ui() {
    local label="$1"
    local remote_path="/sdcard/colony-android-runtime-${label}.xml"
    local output_path="$output_dir/${label}.xml"
    local temp_path="${output_path}.tmp"
    rm -f "$output_path" "$temp_path"
    # Remove the remote dump first so a failed dump cannot be mistaken for a
    # previous iteration's hierarchy when the same emulator is polled again.
    adb_target shell rm -f "$remote_path" >/dev/null || return 1
    adb_target shell uiautomator dump "$remote_path" >/dev/null || return 1
    adb_target exec-out cat "$remote_path" > "$temp_path" || {
        rm -f "$temp_path"
        return 1
    }
    adb_target shell rm -f "$remote_path" >/dev/null || {
        rm -f "$temp_path"
        return 1
    }
    if ! test -s "$temp_path"; then
        rm -f "$temp_path"
        return 1
    fi
    mv "$temp_path" "$output_path"
}

capture_screen() {
    local label="$1"
    foreground_is_expected "$label" ||
        die "expected package is not foreground before ${label} screenshot"
    adb_target exec-out screencap -p > "$output_dir/${label}.png"
    test -s "$output_dir/${label}.png"
    file "$output_dir/${label}.png"
}

assert_ui() {
    local ui_file="$1"
    local screen="$2"
    python3 "$parser_path" ui --package "$package" --screen "$screen" "$ui_file"
}

foreground_is_expected() {
    local label="$1"
    local foreground_file="$output_dir/${label}-foreground.txt"
    local foreground_error="$output_dir/${label}-foreground-error.log"
    local foreground_output
    rm -f "$foreground_file"
    foreground_output="$(adb_target shell dumpsys window windows 2>"$foreground_error" | tr -d '\r')" ||
        return 1
    printf '%s\n' "$foreground_output" > "$foreground_file"
    python3 "$parser_path" foreground --package "$package" < "$foreground_file"
}

wait_for_ui() {
    local label="$1"
    local screen="$2"
    local deadline=$((SECONDS + ui_timeout_seconds))
    rm -f "$output_dir/${label}.xml" "$output_dir/${label}-foreground.txt"
    while ((SECONDS < deadline)); do
        if foreground_is_expected "$label" &&
            dump_ui "$label" 2>"$output_dir/${label}-dump-error.log" &&
            assert_ui "$output_dir/${label}.xml" "$screen"; then
            echo "UI assertion passed: screen=$screen label=$label"
            return 0
        fi
        sleep 2
    done
    echo "UI assertion timed out after ${ui_timeout_seconds}s: $label" >&2
    return 1
}

tap_app_label() {
    local ui_file="$1"
    local label="$2"
    local point
    local x
    local y
    point="$(python3 "$parser_path" tap-point --package "$package" --label "$label" "$ui_file")" ||
        die "could not find a clickable app-owned UI label: $label"
    read -r x y <<<"$point"
    [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]] ||
        die "parser returned invalid tap coordinates for: $label"
    adb_target shell input tap "$x" "$y"
    echo "Tapped app label: $label"
}

launch_app() {
    local label="$1"
    local launch_output
    # Do not wait for Flutter's first frame in `am start`: Android's synchronous
    # wait can time out while the activity is still starting. The bounded UI
    # poll below is the readiness check for the real app surface.
    launch_output="$(adb_target shell am start -n "$activity" 2>&1 | tr -d '\r')" || {
        printf '%s\n' "$launch_output" > "$output_dir/${label}-launch.txt"
        return 1
    }
    printf '%s\n' "$launch_output" > "$output_dir/${label}-launch.txt"
    cat "$output_dir/${label}-launch.txt"
    grep -Fq 'Starting: Intent' "$output_dir/${label}-launch.txt"
}

if ! launch_app initial; then
    die "launcher activity did not start successfully; see initial-launch.txt"
fi
wait_for_ui initial account-entry
capture_screen initial

tap_app_label "$output_dir/initial.xml" "Advanced: use an existing Nostr identity"
wait_for_ui advanced-pairing pairing
capture_screen advanced-pairing

adb_target shell input keyevent 4
wait_for_ui after-advanced-back account-entry

echo "Force-stopping $package"
adb_target shell am force-stop "$package"

if ! launch_app relaunch; then
    die "launcher activity did not restart successfully; see relaunch-launch.txt"
fi
wait_for_ui relaunch account-entry
capture_screen relaunch

{
    echo "relaunch=passed"
    echo "force_stop=issued"
    echo "fresh_install_ui=account-entry with create account, Google, sign in, and Advanced"
    echo "advanced_pairing_ui=Scan a QR code reachable through Advanced"
    echo "relaunch_ui=account-entry after force-stop"
} > "$output_dir/lifecycle.txt"

echo "Android emulator runtime proof passed"
