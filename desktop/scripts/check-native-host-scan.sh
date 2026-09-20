#!/usr/bin/env bash
set -euo pipefail

source_root=""
dependency_tree=""
while (($# > 0)); do
  case "$1" in
    --source-root)
      source_root="${2:?missing source root}"
      shift 2
      ;;
    --dependency-tree)
      dependency_tree="${2:?missing dependency tree}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$source_root" || -z "$dependency_tree" ]]; then
  echo "usage: $0 --source-root PATH --dependency-tree PATH" >&2
  exit 2
fi

scanner="${GREP_BIN:-grep}"
if ! command -v "$scanner" >/dev/null 2>&1; then
  echo "required standalone-host scanner is unavailable: $scanner" >&2
  exit 2
fi

pattern='tauri|wry|src-tauri'
scan_source() {
  local status
  echo "standalone_host_scanner_probe=source tool=$scanner target=$source_root"
  if "$scanner" -RniE "$pattern" "$source_root"; then
    echo "standalone host contains a forbidden Tauri/WebView reference" >&2
    exit 1
  else
    status=$?
    if [[ "$status" -ne 1 ]]; then
      echo "standalone host source scan failed with scanner status $status" >&2
      exit "$status"
    fi
  fi
  echo "standalone_host_scanner_pass=source"
}

scan_dependency_tree() {
  local status
  echo "standalone_host_scanner_probe=dependency-tree tool=$scanner target=$dependency_tree"
  if "$scanner" -niE '(^|[- ])(tauri|wry)([- ])|src-tauri' "$dependency_tree"; then
    echo "standalone host dependency tree contains Tauri/WebView" >&2
    exit 1
  else
    status=$?
    if [[ "$status" -ne 1 ]]; then
      echo "standalone host dependency scan failed with scanner status $status" >&2
      exit "$status"
    fi
  fi
  echo "standalone_host_scanner_pass=dependency-tree"
}

scan_source
scan_dependency_tree
echo "standalone_host_scanner=passed"
