#!/bin/bash
# THROWAWAY probe 3: does installing first, then re-activating, remove the stub hops?
set -u
LOG="${RUNNER_TEMP:-/tmp}/probe"; mkdir -p "$LOG"
sudo apt-get install -y -qq strace >/dev/null 2>&1
echo "PATH before: $PATH" | tr ':' '\n' | head -12
echo "--- hermit install"
time ./bin/hermit install ${PROBE_PKGS:-node pnpm just}
echo "--- hermit env --raw (PATH, LINK_FARM)"
./bin/hermit env --raw | grep -E '^(PATH|HERMIT_LINK_FARM)=' | tr ':' '\n' | head -16
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < <(./bin/hermit env --raw)
echo "--- farm contents: $HERMIT_LINK_FARM"; ls -l "$HERMIT_LINK_FARM"
echo "--- which"; type -a node pnpm just 2>&1 | head
echo "--- execve of install"
for i in 1 2 3; do
  rm -rf node_modules desktop/node_modules web/node_modules admin-web/node_modules
  strace -f -qq -e trace=execve -s 200 -o "$LOG/exec-$i.txt" just desktop-install-ci > "$LOG/inst-$i.log" 2>&1
  echo "install $i rc=$? stub-hops(bin/ execs ok)=$(grep -c 'execve("[^"]*/colony-ai/bin/[a-z]*", .*= 0' "$LOG/exec-$i.txt") hermit-execs=$(grep -c 'hermit@stable/hermit' "$LOG/exec-$i.txt")"
done
grep -E 'colony-ai/bin/[a-z]*", .*= 0' "$LOG/exec-1.txt" | cut -c1-200 | head
