#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'usage: %s dogfood|release\n' "$0" >&2
  exit 2
}

[[ "$#" -eq 1 ]] || usage

flavor="$1"
case "$flavor" in
  dogfood)
    config_name="GoogleAuthDebug.xcconfig"
    ;;
  release)
    config_name="GoogleAuthRelease.xcconfig"
    ;;
  *)
    usage
    ;;
esac

scheme="${COLONY_GOOGLE_REVERSED_CLIENT_ID:-}"
if [[ ! "$scheme" =~ ^[A-Za-z0-9.-]+$ || ${#scheme} -gt 512 ]]; then
  printf 'COLONY_GOOGLE_REVERSED_CLIENT_ID must be a non-empty URL scheme.\n' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_dir="$repo_root/mobile/ios/Flutter"
config_path="$config_dir/$config_name"
temporary="$(mktemp "$config_dir/.google-auth.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT

umask 077
printf 'COLONY_GOOGLE_REVERSED_CLIENT_ID = %s\n' "$scheme" >"$temporary"
chmod 600 "$temporary"
mv -f -- "$temporary" "$config_path"
printf 'Wrote Google OAuth callback configuration for %s.\n' "$flavor"
