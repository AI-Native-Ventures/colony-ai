#!/usr/bin/env bash
# Smoke contract for the Colony cloud agent image (Dockerfile.colony-agent).
#
# Usage: scripts/test-colony-agent-image.sh [image]
# SKIP_BUILD=1 reuses an image that is already loaded into the local daemon.
#
# Nothing here talks to a relay, Fly or the network: the image is only run
# without a boot token and asked for its version and help text.
set -euo pipefail

IMAGE="${1:-colony-agent:contract-test}"
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
    docker build --file Dockerfile.colony-agent --tag "$IMAGE" .
fi

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

# 1. No boot token: the entrypoint must refuse to start and say why.
set +e
no_token_out="$(docker run --rm -e COLONY_CLOUD_BOOT_URL=https://relay.example.test/api/cloud-agents/boot "$IMAGE" 2>&1)"
no_token_rc=$?
set -e
[[ "$no_token_rc" -ne 0 ]] || fail "image started without COLONY_CLOUD_BOOT_TOKEN"
grep -q "missing COLONY_CLOUD_BOOT_TOKEN" <<<"$no_token_out" \
    || fail "no-token run did not print 'missing COLONY_CLOUD_BOOT_TOKEN' (got: $no_token_out)"

# 2. No boot URL: same refusal, different message.
set +e
no_url_out="$(docker run --rm -e COLONY_CLOUD_BOOT_TOKEN=test-token "$IMAGE" 2>&1)"
no_url_rc=$?
set -e
[[ "$no_url_rc" -ne 0 ]] || fail "image started without COLONY_CLOUD_BOOT_URL"
grep -q "missing COLONY_CLOUD_BOOT_URL" <<<"$no_url_out" \
    || fail "no-url run did not print 'missing COLONY_CLOUD_BOOT_URL' (got: $no_url_out)"

# 3. The binaries the cloud agent needs are present and answer.
# (--help, not --version: clap only adds --version when a crate sets one.)
assert_run() {
    docker run --rm --entrypoint /bin/bash "$IMAGE" -ceu "$1"
}

assert_run '
  sprig --version | grep -q "^sprig "
  buzz-acp --help >/dev/null
  colony --help >/dev/null
  command -v buzz-agent buzz-dev-mcp rg git jq curl su-exec >/dev/null
  for name in buzz-acp buzz-agent buzz-dev-mcp rg tree buzz colony git-credential-nostr git-sign-nostr; do
    test "$(readlink "/usr/local/bin/$name")" = sprig
  done
'

# 4. Plan-login runtimes must not be in the image (spec section 3, anti-goal).
assert_run '
  for name in claude codex opencode goose; do
    if command -v "$name" >/dev/null 2>&1; then
      echo "unexpected runtime in image: $name" >&2
      exit 1
    fi
  done
'

# 5. Layout: state lives on the volume mounted at /data, git signs with Nostr
#    keys, the entrypoint hands over to the harness with exec, and the harness
#    runs as the unprivileged agent user.
assert_run '
  test "$HOME" = /data/home
  test "$(git config --system gpg.x509.program)" = /usr/local/bin/git-sign-nostr
  if git config --system --get-all credential.helper >/dev/null 2>&1; then
    echo "global credential.helper must not be set" >&2
    exit 1
  fi
  grep -Eq "^[[:space:]]*exec su-exec agent buzz-acp" /usr/local/bin/colony-agent-entrypoint
  grep -Eq "^[[:space:]]*exec buzz-acp" /usr/local/bin/colony-agent-entrypoint
  id agent >/dev/null
'

# 6. The image config must not carry secrets, a boot token or a relay URL:
#    those arrive only through the Fly machine config at start time.
config="$(docker image inspect "$IMAGE" --format '{{json .Config.Env}}')"
for forbidden in COLONY_CLOUD_BOOT_TOKEN BUZZ_PRIVATE_KEY NOSTR_PRIVATE_KEY OPENROUTER; do
    ! grep -q "$forbidden" <<<"$config" || fail "image env contains $forbidden"
done

echo "PASS: Colony agent image contract ($IMAGE)"
