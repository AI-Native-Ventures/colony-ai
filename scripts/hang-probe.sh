#!/bin/bash
# THROWAWAY probe (C3-CI-INSTALL-HANG-1): catch a hermit stub hang and dump what it waits on.
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"
mkdir -p "$LOG" /tmp/hermit-trace
VARIANT="${PROBE_VARIANT:-A}"
HERMIT_REAL="$HOME/.cache/hermit/pkg/hermit@stable/hermit"
echo "variant=$VARIANT"
echo "hermit version: $("$HERMIT_REAL" version 2>&1 | head -3)"
echo "runner: $(uname -r) $(nproc) cpus $(awk '/MemTotal/{print $2}' /proc/meminfo) kB"
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

# Phase 1: raw stub exec loop (no pnpm). Count hangs of a trivial stub call.
stubs=0; hangs=0
for k in $(seq 1 "${PROBE_STUB_CALLS:-150}"); do
  for tool in "node -e 0" "just --version" "pnpm --version"; do
    stubs=$((stubs+1))
    timeout 25 $tool >/dev/null 2>"$LOG/stub.err"
    rc=$?
    if [ $rc -eq 124 ]; then hangs=$((hangs+1)); echo "::warning::STUB HANG ($tool) call $stubs"; fi
  done
done
echo "stub calls=$stubs hangs=$hangs"

# Phase 2: repeated fresh installs.
for i in $(seq 1 "${PROBE_ROUNDS:-10}"); do
  rm -rf node_modules desktop/node_modules web/node_modules admin-web/node_modules
  start=$(date +%s)
  setsid just desktop-install-ci > "$LOG/install-$i.log" 2>&1 &
  pid=$!
  hung=0
  while kill -0 "$pid" 2>/dev/null; do
    now=$(date +%s)
    if [ $((now-start)) -ge "${PROBE_LIMIT:-60}" ]; then
      hung=1
      echo "::warning::INSTALL HANG round $i after $((now-start))s"
      tail -5 "$LOG/install-$i.log"
      dump "install-round-$i"
      kill -9 -- "-$pid" 2>/dev/null
      sudo pkill -9 -x hermit 2>/dev/null
      break
    fi
    sleep 1
  done
  wait "$pid" 2>/dev/null
  echo "round $i hung=$hung secs=$(( $(date +%s) - start ))"
done
