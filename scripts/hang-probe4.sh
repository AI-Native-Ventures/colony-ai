#!/bin/bash
# THROWAWAY probe 4: which tools become direct after pre-install + one materializing stub call?
set -u
PKGS="${PROBE_PKGS:-node pnpm just rustup cargo-deny cmake}"
./bin/hermit install $PKGS
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done < <(./bin/hermit env --raw)
echo "farm=$HERMIT_LINK_FARM exists_before=$([ -d "$HERMIT_LINK_FARM" ] && echo yes || echo no)"
just --version
echo "exists_after=$([ -d "$HERMIT_LINK_FARM" ] && echo yes || echo no)"
ls -l "$HERMIT_LINK_FARM" 2>&1 | head -30
for t in node pnpm just cargo rustc cargo-deny cmake; do echo "$t -> $(command -v $t)"; done
echo "--- cargo --version via PATH"; cargo --version 2>&1 | head -3
