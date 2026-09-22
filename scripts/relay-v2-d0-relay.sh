#!/usr/bin/env bash
# Start a disposable source-built buzz-relay for the RelayV2 D0 proof.
# Mirrors scripts/start-relay-for-tests.sh on an isolated port tuple so the
# shared :3000 relay and the default dev stack are never touched.
# Open membership (NIP-42 still enforced); the helper exercises challenge,
# sign, AUTH, subscribe, publish, and close against this relay.
#
# Usage: ./scripts/relay-v2-d0-relay.sh [--build|--no-build] [--port N]
# Prints KEY=VALUE lines (RELAY_PID/RELAY_URL/RELAY_LOG) for the runner.
set -euo pipefail

BUILD=1
RELAY_PORT=18081
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --no-build) BUILD=0; shift ;;
    --port) RELAY_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

if [[ "${BUILD}" == "1" ]]; then
  cargo build --profile ci -p buzz-relay
fi
BIN="${REPO_ROOT}/target/ci/buzz-relay"
[[ -x "${BIN}" ]] || { echo "relay binary missing at ${BIN}" >&2; exit 1; }

TEST_RELAY_PRIVATE_KEY="${BUZZ_RELAY_PRIVATE_KEY:-$(openssl rand -hex 32)}"
HEALTH_PORT=$((RELAY_PORT + 1))
LOG="$(mktemp -t relay-v2-d0.XXXXXX.log)"

nohup env \
  DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz \
  REDIS_URL=redis://localhost:6379 \
  RELAY_URL="ws://127.0.0.1:${RELAY_PORT}" \
  BUZZ_BIND_ADDR="0.0.0.0:${RELAY_PORT}" \
  BUZZ_HEALTH_PORT="${HEALTH_PORT}" \
  BUZZ_RELAY_PRIVATE_KEY="${TEST_RELAY_PRIVATE_KEY}" \
  BUZZ_REQUIRE_AUTH_TOKEN=false \
  BUZZ_RECONCILE_CHANNELS=true \
  "${BIN}" > "${LOG}" 2>&1 &
RELAY_PID=$!
echo "${RELAY_PID}" > /tmp/relay-v2-d0.pid

for _ in $(seq 1 60); do
  if ! kill -0 "${RELAY_PID}" 2>/dev/null; then
    echo "relay process died; log: ${LOG}" >&2
    cat "${LOG}" >&2
    exit 1
  fi
  if [[ "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${RELAY_PORT}/_readiness" || true)" == "200" ]]; then
    break
  fi
  sleep 1
done
[[ "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${RELAY_PORT}/_readiness" || true)" == "200" ]] \
  || { echo "relay not ready; log: ${LOG}" >&2; cat "${LOG}" >&2; exit 1; }

echo "RELAY_PID=${RELAY_PID}"
echo "RELAY_URL=ws://127.0.0.1:${RELAY_PORT}"
echo "RELAY_LOG=${LOG}"
