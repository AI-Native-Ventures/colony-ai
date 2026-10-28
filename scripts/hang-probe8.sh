#!/bin/bash
# THROWAWAY probe 8: first nodejs.org connection goes idle (local proxy). A: today. B: the fix.
# Variant A: today's flow. Variant B: the fix. The cut is lifted 50 s after the job starts.
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"; mkdir -p "$LOG"
VARIANT="${PROBE_VARIANT:-A}"
REPO="$PWD"
H="$HOME/.cache/hermit"


python3 scripts/hang-probe8-proxy.py > "$LOG/proxy.log" 2>&1 &
proxy=$!
sleep 1
export HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899
chmod -R u+w "$H/pkg" "$H/binaries" 2>/dev/null
rm -rf "$H/pkg/node-"* "$H/pkg/pnpm-"* "$H/pkg/just-"* "$H/environments" "$H/binaries" "$H/cache" "$REPO/node_modules" "$REPO/desktop/node_modules" "$REPO/web/node_modules" "$REPO/admin-web/node_modules"
start=$(date +%s)
: > "$LOG/ghenv"
(
  export GITHUB_ENV="$LOG/ghenv"
  load() { while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < "$1"; }
  "$REPO/bin/hermit" env --raw > "$LOG/act.env"; load "$LOG/act.env"
  cd "$REPO"
  if [ "$VARIANT" = "B" ]; then
    scripts/ci-hermit-ready.sh just node pnpm 2>&1 | tee "$LOG/ready.log"
    [ "${PIPESTATUS[0]}" = "0" ] || exit 9
    load "$LOG/ghenv"
  fi
  pnpm store path --silent >/dev/null
  if [ "$VARIANT" = "B" ]; then
    scripts/ci-bounded.sh 240 3 just desktop-install-ci > "$LOG/install.log" 2>&1
  else
    timeout 130 just desktop-install-ci > "$LOG/install.log" 2>&1
  fi
)
rc=$?
echo "RESULT variant=$VARIANT rc=$rc secs=$(( $(date +%s) - start )) proxy=$(tr '\n' ';' < "$LOG/proxy.log") hung_attempts=$(cat "$LOG/ready.log" "$LOG/install.log" 2>/dev/null | grep -c 'hung for')"
kill "$proxy" 2>/dev/null
tail -4 "$LOG/install.log"
# rerun with idle detection
