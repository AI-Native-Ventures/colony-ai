#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
scanner="$script_dir/check-native-host-scan.sh"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

mkdir -p "$fixture_dir/clean" "$fixture_dir/forbidden"
printf 'fn main() {}\n' > "$fixture_dir/clean/main.rs"
printf 'serde_json v1.0.0\n' > "$fixture_dir/clean-tree.txt"
printf 'use tauri::Builder;\n' > "$fixture_dir/forbidden/main.rs"
printf 'tauri v2.0.0\n' > "$fixture_dir/forbidden-tree.txt"

clean_output="$(
  bash "$scanner" \
    --source-root "$fixture_dir/clean" \
    --dependency-tree "$fixture_dir/clean-tree.txt"
)"
[[ "$clean_output" == *"standalone_host_scanner_probe=source"* ]]
[[ "$clean_output" == *"standalone_host_scanner_probe=dependency-tree"* ]]
[[ "$clean_output" == *"standalone_host_scanner=passed"* ]]

if bash "$scanner" \
  --source-root "$fixture_dir/forbidden" \
  --dependency-tree "$fixture_dir/clean-tree.txt"; then
  echo "forbidden source fixture unexpectedly passed" >&2
  exit 1
fi

if bash "$scanner" \
  --source-root "$fixture_dir/clean" \
  --dependency-tree "$fixture_dir/forbidden-tree.txt"; then
  echo "forbidden dependency fixture unexpectedly passed" >&2
  exit 1
fi

if GREP_BIN="$fixture_dir/missing-scanner" bash "$scanner" \
  --source-root "$fixture_dir/clean" \
  --dependency-tree "$fixture_dir/clean-tree.txt"; then
  echo "missing scanner unexpectedly passed" >&2
  exit 1
fi

echo "standalone_host_scanner_fixture_probe=passed"
