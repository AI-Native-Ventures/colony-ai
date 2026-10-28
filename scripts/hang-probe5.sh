#!/bin/bash
# THROWAWAY probe 5: does a healthy "hermit exec node" touch the network, and what does it do?
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"; mkdir -p "$LOG" /tmp/hermit-trace
sudo apt-get install -y -qq strace >/dev/null 2>&1
HERMIT_REAL="$HOME/.cache/hermit/pkg/hermit@stable/hermit"
node -e 0; just --version >/dev/null; pnpm --version >/dev/null   # warm: everything installed
for t in "node -e 0" "just --version" "pnpm --version"; do
  name=$(echo "$t" | tr ' ' '_')
  echo "::group::strace network + file opens for: $t"
  strace -f -qq -tt -e trace=connect,openat -o "$LOG/net-$name.txt" ./bin/$t >/dev/null 2>&1
  echo "connect() calls:"; grep -E 'connect\(' "$LOG/net-$name.txt" | grep -v ENOENT | grep -E 'sin_addr|sin6_addr' | sed -E 's/^[0-9]+ +//' | cut -c1-160 | head -10
  echo "opens under hermit cache (not pkg binaries):"; grep -E 'openat\(.*(hermit/(cache|sources|state|\.lock)|\.lock|db)' "$LOG/net-$name.txt" | grep -v ENOENT | sed -E 's/^[0-9]+ +//' | cut -c1-180 | head -12
  echo "::endgroup::"
done
echo "::group::trace log of one healthy node exec"
rm -f /tmp/hermit-trace/*
"$HERMIT_REAL" --level=trace exec "$PWD/bin/node" -- -e 0 2>/tmp/hermit-trace/node.log
cut -c1-220 /tmp/hermit-trace/node.log | head -80
echo "::endgroup::"
echo "::group::reachability"
for u in https://nodejs.org/dist/v24.15.0/SHASUMS256.txt.asc https://github.com/cashapp/hermit-packages https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz; do
  echo "$u -> $(curl -sS -o /dev/null -m 20 -I -w '%{http_code} %{remote_ip} %{time_total}s' "$u" 2>&1)"
done
getent hosts nodejs.org
echo "::endgroup::"
