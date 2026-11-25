#!/bin/bash
set -euo pipefail

# Entrypoint of the Colony cloud agent image.
#
# A Fly machine for a cloud agent is configured with exactly two variables:
# COLONY_CLOUD_BOOT_URL and a single-use COLONY_CLOUD_BOOT_TOKEN. The harness
# (buzz-acp) redeems the token itself on startup and applies the secrets it
# gets back, so this script never sees the agent key. Its jobs are:
#   1. refuse to start without a boot token (this image has no other mode),
#   2. prepare the volume mounted at /data,
#   3. point git at the relay for this agent's repositories,
#   4. hand over to the harness as the unprivileged `agent` user, with exec so
#      the harness receives termination signals directly.

if [[ -z "${COLONY_CLOUD_BOOT_TOKEN:-}" ]]; then
    echo "missing COLONY_CLOUD_BOOT_TOKEN" >&2
    exit 64
fi
if [[ -z "${COLONY_CLOUD_BOOT_URL:-}" ]]; then
    echo "missing COLONY_CLOUD_BOOT_URL" >&2
    exit 64
fi

data_dir="/data"
home_dir="${HOME:-/data/home}"
workspace_dir="${data_dir}/workspace"

if [[ "$(id -u)" == 0 ]]; then
    # A fresh Fly volume is mounted root-owned. Fix the top level only; never
    # recurse, so a large volume does not slow every wake.
    install -d -o agent -g agent "$data_dir" "$home_dir" "$workspace_dir"
    as_agent=(su-exec agent)
else
    mkdir -p "$home_dir" "$workspace_dir"
    as_agent=()
fi

# Match the desktop's URL-scoped git credential configuration without
# installing a helper globally. The relay origin is the boot URL's origin.
if [[ "$COLONY_CLOUD_BOOT_URL" =~ ^(https?://[^/]+) ]]; then
    relay_http_url="${BASH_REMATCH[1]}"
    "${as_agent[@]}" git config --global "credential.${relay_http_url}/git.helper" \
        /usr/local/bin/git-credential-nostr
    "${as_agent[@]}" git config --global "credential.${relay_http_url}/git.useHttpPath" true
fi

cd "$workspace_dir"

if [[ "$(id -u)" == 0 ]]; then
    exec su-exec agent buzz-acp "$@"
fi
exec buzz-acp "$@"
