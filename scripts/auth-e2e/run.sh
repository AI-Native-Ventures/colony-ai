#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

. ./bin/activate-hermit

if [[ -n "${RESEND_API_KEY:-}" ]]; then
  echo "RESEND_API_KEY must be unset for the local mail sink" >&2
  exit 1
fi

export CARGO_BUILD_JOBS=4
export RELAY_URL="${RELAY_URL:-ws://localhost:3000}"
export COLONY_MAIL_SINK=log
export COLONY_ACCOUNT_KEK="$(openssl rand -base64 32 | tr -d '\n')"
export COLONY_GOOGLE_CLIENT_IDS="${COLONY_GOOGLE_CLIENT_IDS:-colony-auth-e2e-client}"
export COLONY_GOOGLE_JWKS_URL="${COLONY_GOOGLE_JWKS_URL:-http://127.0.0.1:8765/.well-known/jwks.json}"
export COLONY_TEST_GOOGLE_TOKEN_URL="${COLONY_TEST_GOOGLE_TOKEN_URL:-http://127.0.0.1:8765/token}"
export COLONY_TEST_GOOGLE_AUDIENCE="${COLONY_TEST_GOOGLE_AUDIENCE:-colony-auth-e2e-client}"

if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::add-mask::${COLONY_ACCOUNT_KEK}"
fi

node scripts/auth-e2e/google-jwks.mjs > /tmp/colony-auth-e2e-jwks.log 2>&1 &
JWKS_PID=$!
RELAY_PID=""
RELAY_PID_FILE="/tmp/buzz-relay.pid"
RELAY_PID_BEFORE=""
if [[ -f "${RELAY_PID_FILE}" ]]; then
  RELAY_PID_BEFORE="$(<"${RELAY_PID_FILE}")"
fi

cleanup() {
  if [[ -z "${RELAY_PID}" && -s "${RELAY_PID_FILE}" ]]; then
    candidate_pid="$(<"${RELAY_PID_FILE}")"
    if [[ "${candidate_pid}" =~ ^[0-9]+$ && "${candidate_pid}" != "${RELAY_PID_BEFORE}" ]]; then
      RELAY_PID="${candidate_pid}"
    fi
  fi
  if [[ -n "${RELAY_PID}" ]] && kill -0 "${RELAY_PID}" 2>/dev/null; then
    kill "${RELAY_PID}" 2>/dev/null || true
    wait "${RELAY_PID}" 2>/dev/null || true
  fi
  if kill -0 "${JWKS_PID}" 2>/dev/null; then
    kill "${JWKS_PID}" 2>/dev/null || true
    wait "${JWKS_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for attempt in $(seq 1 30); do
  if curl --silent --fail "http://127.0.0.1:8765/healthz" >/dev/null; then
    break
  fi
  if ! kill -0 "${JWKS_PID}" 2>/dev/null; then
    echo "test JWKS server stopped before becoming ready" >&2
    exit 1
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "test JWKS server did not become ready within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done

./scripts/start-relay-for-tests.sh --profile ci
RELAY_PID="$(<"${RELAY_PID_FILE}")"

cargo test -p buzz-test-client --test e2e_accounts -- \
  --ignored --nocapture --test-threads=1
