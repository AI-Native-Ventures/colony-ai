#!/usr/bin/env bash
# Prove the existing Flutter Android APK can run on one disposable emulator.
# This deliberately does not configure a relay, account, auth, or pairing
# state; those are later interoperability gates.
set -euo pipefail

package="${ANDROID_PACKAGE:-ventures.ainative.colony.dogfood}"
activity="${ANDROID_ACTIVITY:-${package}/xyz.block.buzz.mobile.MainActivity}"
apk_path="${APK_PATH:-mobile/build/app/outputs/flutter-apk/app-debug.apk}"
output_dir="${ANDROID_RUNTIME_ARTIFACT_DIR:-android-runtime-artifacts}"
source_sha="${SOURCE_SHA:-${GITHUB_SHA:-unknown}}"
ui_timeout_seconds="${ANDROID_RUNTIME_UI_TIMEOUT_SECONDS:-45}"
adb_timeout_seconds="${ANDROID_RUNTIME_ADB_TIMEOUT_SECONDS:-20}"
install_timeout_seconds="${ANDROID_RUNTIME_INSTALL_TIMEOUT_SECONDS:-60}"
anr_dismiss_timeout_seconds="${ANDROID_RUNTIME_ANR_DISMISS_TIMEOUT_SECONDS:-15}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
parser_path="${ANDROID_RUNTIME_PARSER:-$script_dir/android-runtime-proof-parser.py}"
failure_label="runtime"
launcher_anr_dismissed=0
launcher_anr_launch_retry_used=0

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

capture_failure_evidence() {
    local label="${failure_label:-runtime}"
    local raw_log="${TMPDIR:-/tmp}/colony-android-runtime-logcat-${GITHUB_RUN_ID:-0}-$$.txt"
    local safe_log="$output_dir/failure-logcat.txt"

    {
        echo "failure_label=$label"
        echo "launcher_anr_dismissed=$launcher_anr_dismissed"
        echo "launcher_anr_launch_retry_used=$launcher_anr_launch_retry_used"
    } > "$output_dir/failure.txt"

    adb_target exec-out screencap -p > "$output_dir/failure-${label}.png" \
        2> "$output_dir/failure-screenshot-error.log" || true
    adb_target shell dumpsys window windows > "$output_dir/failure-windows.txt" \
        2> "$output_dir/failure-windows-error.log" || true
    adb_target logcat -d -t 800 -b main -b system -b crash \
        -s ActivityManager:W ActivityTaskManager:W WindowManager:W AndroidRuntime:E \
        > "$raw_log" 2> "$output_dir/failure-logcat-error.log" || true

    python3 - "$raw_log" "$safe_log" <<'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
sensitive = re.compile(
    r"(?i)\bauthorization\s*:|\bbearer\s+\S{12,}|"
    r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|"
    r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|"
    r"\bsk-[A-Za-z0-9]{20,}\b|\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+"
)
max_bytes = 2 * 1024 * 1024
written = 0
with source.open("r", encoding="utf-8", errors="replace") as input_file, target.open(
    "w", encoding="utf-8"
) as output_file:
    for line in input_file:
        encoded = line.encode("utf-8")
        if sensitive.search(line):
            continue
        if written + len(encoded) > max_bytes:
            output_file.write("[remaining logcat lines omitted at 2 MiB cap]\n")
            break
        output_file.write(line)
        written += len(encoded)
PY
    rm -f -- "$raw_log"
}

cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$status" -ne 0 ]]; then
        capture_failure_evidence || true
    fi
    adb_target shell am force-stop "$package" >/dev/null 2>&1 || true
    exit "$status"
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
    echo "apk_signing=${ANDROID_APK_SIGNING:-android-debug}"
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
    local anr_kind
    failure_label="$label"
    rm -f "$output_dir/${label}.xml" "$output_dir/${label}-foreground.txt"
    while ((SECONDS < deadline)); do
        if dump_ui "$label" 2>"$output_dir/${label}-dump-error.log"; then
            if anr_kind="$(python3 "$parser_path" system-anr-kind "$output_dir/${label}.xml" 2>/dev/null)"; then
                echo "Detected Android system ANR kind=$anr_kind label=$label"
                if [[ "$anr_kind" != "pixel-launcher" ]]; then
                    echo "::error::unexpected Android system ANR during $label" >&2
                    return 1
                fi
                if [[ "$launcher_anr_dismissed" == "1" ]]; then
                    echo "::error::Pixel Launcher ANR repeated after its single recovery" >&2
                    return 1
                fi
                launcher_anr_dismissed=1
                if ! dismiss_launcher_anr "$label" "$output_dir/${label}.xml"; then
                    return 1
                fi
                deadline=$((SECONDS + ui_timeout_seconds))
                continue
            fi
            if foreground_is_expected "$label" && assert_ui "$output_dir/${label}.xml" "$screen"; then
                echo "UI assertion passed: screen=$screen label=$label"
                return 0
            fi
        fi
        sleep 2
    done
    echo "UI assertion timed out after ${ui_timeout_seconds}s: $label" >&2
    return 1
}

wait_for_launcher_anr_to_clear() {
    local deadline=$((SECONDS + anr_dismiss_timeout_seconds))
    while ((SECONDS < deadline)); do
        if dump_ui launcher-anr-clear-check 2>"$output_dir/launcher-anr-clear-check-dump-error.log" &&
            ! python3 "$parser_path" system-anr-kind "$output_dir/launcher-anr-clear-check.xml" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

dismiss_launcher_anr() {
    local label="$1"
    local ui_file="$2"
    local point
    local x
    local y

    point="$(python3 "$parser_path" launcher-anr-wait-point "$ui_file")" || {
        echo "::error::Pixel Launcher ANR dialog did not expose its verified Wait action" >&2
        return 1
    }
    read -r x y <<<"$point"
    [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]] || {
        echo "::error::parser returned invalid Android ANR recovery coordinates" >&2
        return 1
    }
    adb_target shell input tap "$x" "$y"
    if ! wait_for_launcher_anr_to_clear; then
        echo "::error::Pixel Launcher ANR dialog did not clear within ${anr_dismiss_timeout_seconds}s" >&2
        return 1
    fi

    if [[ "$label" == "initial" || "$label" == "relaunch" ]]; then
        if [[ "$launcher_anr_launch_retry_used" == "1" ]]; then
            echo "::error::bounded app-launch retry was already used" >&2
            return 1
        fi
        launcher_anr_launch_retry_used=1
        echo "Retrying app launch once after the verified Pixel Launcher ANR"
        adb_target shell am force-stop "$package" >/dev/null 2>&1 || true
        if ! launch_app "${label}-retry"; then
            echo "::error::app did not relaunch after the single launcher-ANR recovery" >&2
            return 1
        fi
    else
        echo "Pixel Launcher recovered; continuing the same $label UI assertion"
    fi
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

tap_app_label "$output_dir/initial.xml" "Pair with my desktop"
wait_for_ui pairing-start pairing
capture_screen pairing-start

adb_target shell input keyevent 4
wait_for_ui after-pairing-back account-entry

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
    echo "fresh_install_ui=account-entry with create an account, sign in, and pair with my desktop"
    echo "pairing_ui=Scan QR code and Enter a code instead reachable through Pair with my desktop"
    echo "relaunch_ui=account-entry after force-stop"
} > "$output_dir/lifecycle.txt"

echo "Android emulator runtime proof passed"
