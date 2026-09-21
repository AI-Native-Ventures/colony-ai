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

mkdir -p "$output_dir"
exec > >(tee "$output_dir/harness.log") 2>&1

die() {
    echo "::error::$*" >&2
    exit 1
}

[[ "$package" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]] ||
    die "ANDROID_PACKAGE is not a valid application id"
[[ "$activity" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*/\.[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "ANDROID_ACTIVITY is not a valid component name"
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
    adb_target shell uiautomator dump "$remote_path" >/dev/null
    adb_target exec-out cat "$remote_path" > "$output_dir/${label}.xml"
    adb_target shell rm -f "$remote_path"
}

capture_screen() {
    local label="$1"
    adb_target exec-out screencap -p > "$output_dir/${label}.png"
    test -s "$output_dir/${label}.png"
    file "$output_dir/${label}.png"
}

assert_initial_ui() {
    local ui_file="$1"
    # Flutter exposes these labels through Android accessibility semantics,
    # which UIAutomator records as content-desc rather than text attributes.
    grep -Fq 'content-desc="Welcome to Buzz"' "$ui_file" || return 1
    grep -Fq 'content-desc="Scan a QR code"' "$ui_file" || return 1
}

wait_for_initial_ui() {
    local label="$1"
    local deadline=$((SECONDS + ui_timeout_seconds))
    while ((SECONDS < deadline)); do
        if dump_ui "$label" 2>"$output_dir/${label}-dump-error.log" &&
            assert_initial_ui "$output_dir/${label}.xml"; then
            echo "Initial UI assertion passed: $label"
            return 0
        fi
        sleep 2
    done
    echo "UI assertion timed out after ${ui_timeout_seconds}s: $label" >&2
    return 1
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
wait_for_initial_ui initial
capture_screen initial

echo "Force-stopping $package"
adb_target shell am force-stop "$package"

if ! launch_app relaunch; then
    die "launcher activity did not restart successfully; see relaunch-launch.txt"
fi
wait_for_initial_ui relaunch
capture_screen relaunch

{
    echo "relaunch=passed"
    echo "force_stop=issued"
    echo "ui_assertion=Welcome to Buzz; Scan a QR code"
} > "$output_dir/lifecycle.txt"

echo "Android emulator runtime proof passed"
