#!/bin/bash
# THROWAWAY probe 6: repeat a fresh job start with a real nodejs.org download each time.
# Variant A: today's flow (stub downloads node inside pnpm install). Variant B: the fix.
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"; mkdir -p "$LOG"
VARIANT="${PROBE_VARIANT:-A}"
REPO="$PWD"
H="$HOME/.cache/hermit"

cycle() {
  local n="$1"
  chmod -R u+w "$H/pkg" "$H/binaries" 2>/dev/null
  rm -rf "$H/pkg/node-"* "$H/pkg/pnpm-"* "$H/pkg/just-"* "$H/environments" "$H/binaries" "$H/cache" \
         "$REPO/.hermit" "$REPO/node_modules" "$REPO/desktop/node_modules" "$REPO/web/node_modules" "$REPO/admin-web/node_modules"
  local start; start=$(date +%s)
  : > "$LOG/ghenv"
  (
    export GITHUB_ENV="$LOG/ghenv"
    load() { while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < "$1"; }
    "$REPO/bin/hermit" env --raw > "$LOG/act.env"; load "$LOG/act.env"
    cd "$REPO"
    if [ "$VARIANT" = "B" ]; then
      scripts/ci-hermit-ready.sh just node pnpm > "$LOG/ready-$n.log" 2>&1 || { echo "ready failed rc=$?"; tail -5 "$LOG/ready-$n.log"; exit 9; }
      load "$LOG/ghenv"
    fi
    pnpm store path --silent >/dev/null
    if [ "$VARIANT" = "B" ]; then
      scripts/ci-bounded.sh 240 3 just desktop-install-ci > "$LOG/install-$n.log" 2>&1
    else
      timeout 100 just desktop-install-ci > "$LOG/install-$n.log" 2>&1
    fi
  )
  local rc=$?
  local hung; hung=$(cat "$LOG/ready-$n.log" "$LOG/install-$n.log" 2>/dev/null | grep -c "hung for")
  local direct; direct=$(grep -c "runs directly" "$LOG/ready-$n.log" 2>/dev/null)
  echo "cycle $n variant=$VARIANT rc=$rc secs=$(( $(date +%s) - start )) hung_attempts=$hung direct_tools=$direct"
}

for n in $(seq 1 "${PROBE_CYCLES:-8}"); do cycle "$n"; done
