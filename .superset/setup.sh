#!/usr/bin/env bash
# Superset workspace setup: JS deps + .env + git hooks. No Docker, no cargo build
# (Docker services use fixed container names/ports shared by all worktrees; CI is the gate for Rust).
set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
# Hermit-pinned toolchain (node, pnpm, lefthook)
export PATH="$PWD/bin:$PATH"

# .env: reuse root copy (keeps relay key), else seed from template
if [[ ! -f .env ]]; then
  if [[ -n "${SUPERSET_ROOT_PATH:-}" && -f "$SUPERSET_ROOT_PATH/.env" ]]; then
    cp "$SUPERSET_ROOT_PATH/.env" .env
  else
    cp .env.example .env
    ./scripts/ensure-local-relay-key.sh .env
  fi
fi

# pnpm workspace: desktop, web, admin-web
pnpm install --frozen-lockfile

# Git hooks dispatch from the shared .git/hooks dir; idempotent
just hooks || echo "warn: just hooks failed, install manually later" >&2
