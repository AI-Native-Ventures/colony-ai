#!/bin/bash
# THROWAWAY probe 2 (C3-CI-INSTALL-HANG-1): repeat the full fresh-runner start and catch a hang.
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"
mkdir -p "$LOG" /tmp/hermit-trace
VARIANT="${PROBE_VARIANT:-A}"
HERMIT_REAL="$HOME/.cache/hermit/pkg/hermit@stable/hermit"
REPO="$PWD"
sudo apt-get install -y -qq strace >/dev/null 2>&1 || echo "strace install failed"

dump() {
  local tag="$1"
  echo "::group::DIAG $tag"
  echo "=== date $(date -u +%T)"
  echo "=== ps"; ps -eo pid,ppid,pgid,etimes,stat,wchan:32,comm,args --forest | grep -v "ps -eo" | head -90
  for pid in $(pgrep -x hermit); do
    echo "=== hermit pid $pid"
    sudo sh -c "tr '\0' ' ' < /proc/$pid/cmdline; echo; echo wchan=\$(cat /proc/$pid/wchan); cat /proc/$pid/stack 2>&1 | head -20; grep -E 'State|Threads|PPid' /proc/$pid/status; ls -l /proc/$pid/fd 2>&1; for t in /proc/$pid/task/*; do echo \"\$t \$(cat \$t/comm) \$(cat \$t/wchan)\"; done"
    sudo timeout 6 strace -f -tt -p "$pid" -o "$LOG/strace-$pid.txt" >/dev/null 2>&1
    echo "--- strace tail"; tail -40 "$LOG/strace-$pid.txt" 2>&1
    if [ -f "/tmp/hermit-trace/$pid.log" ]; then echo "--- trace tail"; tail -60 "/tmp/hermit-trace/$pid.log"; fi
  done
  echo "=== ss"; sudo ss -tanpoe 2>&1 | head -60
  echo "=== locks"; cat /proc/locks
  echo "=== hermit state"; ls -la "$HOME/.cache/hermit" "$HOME/.cache/hermit/"* 2>&1 | head -80
  if [ "$VARIANT" = "B" ]; then
    for pid in $(pgrep -x hermit); do sudo kill -QUIT "$pid"; done
    sleep 3
    for f in /tmp/hermit-trace/*.log; do
      if grep -q "SIGQUIT\|goroutine " "$f" 2>/dev/null; then echo "=== goroutine dump in $f"; grep -n -A60 "SIGQUIT" "$f" | head -200; fi
    done
  fi
  echo "::endgroup::"
}

cycle() {
  local n="$1"
  # Fresh runner state: no hermit packages, no link farm, no node_modules.
  chmod -R u+w "$HOME/.cache/hermit/pkg" 2>/dev/null
  rm -rf "$HOME/.cache/hermit/pkg/node-"* "$HOME/.cache/hermit/pkg/pnpm-"* "$HOME/.cache/hermit/pkg/just-"* \
         "$HOME/.cache/hermit/environments" "$HOME/.cache/hermit/binaries" "$REPO/.hermit" \
         "$REPO/node_modules" "$REPO/desktop/node_modules" "$REPO/web/node_modules" "$REPO/admin-web/node_modules"
  local start; start=$(date +%s)
  (
    while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < <("$REPO/bin/hermit" env --raw)
    cd "$REPO"
    pnpm store path --silent >/dev/null
    if [ "${PROBE_TRACE_EXEC:-0}" = "1" ] && [ "$n" = "1" ]; then
      setsid strace -f -qq -e trace=execve -s 160 -o "$LOG/execve.txt" just desktop-install-ci > "$LOG/install-$n.log" 2>&1 &
    else
      setsid just desktop-install-ci > "$LOG/install-$n.log" 2>&1 &
    fi
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
      now=$(date +%s)
      if [ $((now-start)) -ge "${PROBE_LIMIT:-75}" ]; then
        echo "::warning::INSTALL HANG cycle $n after $((now-start))s"
        tail -5 "$LOG/install-$n.log"
        dump "cycle-$n"
        kill -9 -- "-$pid" 2>/dev/null
        sudo pkill -9 -x hermit 2>/dev/null
        exit 7
      fi
      sleep 1
    done
    wait "$pid"
  )
  echo "cycle $n rc=$? secs=$(( $(date +%s) - start ))"
}

for n in $(seq 1 "${PROBE_CYCLES:-10}"); do cycle "$n"; done

if [ -f "$LOG/execve.txt" ]; then
  echo "::group::execve names during first install"
  grep -o 'execve("[^"]*"' "$LOG/execve.txt" | sort | uniq -c | sort -rn | head -40
  echo "--- hermit-related execs"
  grep -E 'hermit|/bin/(node|npm|npx|just|pnpm|cargo)' "$LOG/execve.txt" | cut -c1-230 | head -40
  echo "::endgroup::"
fi
