#!/usr/bin/env bash
# Make the Hermit tools a CI job uses run as real binaries instead of through bin/ stubs.
#
# usage: scripts/ci-hermit-ready.sh <package>...      e.g. node pnpm just
#
# A Hermit stub downloads its package the first time it runs. pnpm's own
# `node --version` is the first `node` call of a job, so the Node download happened
# deep inside `pnpm install`, over a connection to nodejs.org that sometimes goes idle
# and that Hermit never times out; the step then sat until the job timeout. See
# docs/ci-hermit-hang.md.
#
# This script moves the download to a step of its own: packages are installed at the
# exact version bin/ pins (never "latest") under a short per-attempt limit that kills
# the whole process group and retries, then the new PATH is exported to the later steps
# of the job. With the packages installed, Hermit's link farm (a directory of direct
# links, on PATH ahead of bin/) lets the tools run without a stub at all.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <package>..." >&2
  exit 2
fi

# bin/.node-24.15.0.pkg pins the reference node-24.15.0.
pinned_ref() {
  local link base
  for link in bin/."$1"-[0-9]*.pkg; do
    [ -e "$link" ] || [ -L "$link" ] || continue
    base=$(basename "$link")
    base=${base#.}
    echo "${base%.pkg}"
    return 0
  done
  return 1
}

refs=()
for name in "$@"; do
  if ! ref=$(pinned_ref "$name"); then
    echo "::error::bin/ does not pin a Hermit package named $name" >&2
    exit 1
  fi
  refs+=("$ref")
done

# A healthy download takes a few seconds; an idle connection never recovers.
scripts/ci-bounded.sh 60 5 ./bin/hermit install "${refs[@]}"

# Installing must never move a pin.
if ! git diff --quiet -- bin; then
  echo "::error::hermit install changed bin/; the job must use the pinned versions" >&2
  git diff --stat -- bin >&2
  exit 1
fi

# The farm path depends on which packages are installed, so activate again.
env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT
./bin/hermit env --raw > "$env_file"
if [ -n "${GITHUB_ENV:-}" ]; then
  cat "$env_file" >> "$GITHUB_ENV"
fi
while IFS='=' read -r key value; do
  if [ -n "$key" ]; then
    export "$key=$value"
  fi
done < "$env_file"

# Hermit creates the farm directory on its first stub call; make that call now.
scripts/ci-bounded.sh 60 3 just --version >/dev/null

for name in "$@"; do
  resolved=$(command -v "$name" || true)
  case "$resolved" in
    "$root"/bin/*) echo "::warning::$name still runs through the Hermit stub: $resolved" ;;
    *) echo "$name runs directly: ${resolved:-not found}" ;;
  esac
done
