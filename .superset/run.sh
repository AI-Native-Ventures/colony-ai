#!/usr/bin/env bash
# Desktop frontend dev server (Vite). Port derived from worktree path, so workspaces don't collide.
set -euo pipefail
cd "${SUPERSET_WORKSPACE_PATH:-$(pwd)}"
export PATH="$PWD/bin:$PATH"
exec just desktop-dev
