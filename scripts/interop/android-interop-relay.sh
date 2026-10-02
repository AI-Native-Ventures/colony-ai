#!/usr/bin/env bash
set -euo pipefail

peer_script="${ANDROID_INTEROP_PEER_DIR:?ANDROID_INTEROP_PEER_DIR is required}/android-interop-peer.mjs"

usage() {
  echo "Usage: $0 seed-owner" >&2
}

if [[ $# -ne 1 || "$1" != "seed-owner" ]]; then
  usage
  exit 2
fi

pubkey="$(node "$peer_script" pubkey)"
[[ "$pubkey" =~ ^[0-9a-f]{64}$ ]] || {
  echo "peer public key is not canonical hex" >&2
  exit 1
}

# start-relay-for-tests.sh seeds this tenant for localhost:3000. The
# ephemeral peer becomes its sole owner so it can mint one short-lived invite.
docker exec -i -e PGPASSWORD=buzz_dev buzz-postgres \
  psql -U buzz -d buzz -v ON_ERROR_STOP=1 -qtA <<SQL
INSERT INTO relay_members (community_id, pubkey, role, added_by)
VALUES (
  '00000000-0000-4000-8000-00000000c0de',
  '${pubkey}',
  'owner',
  '${pubkey}'
)
ON CONFLICT (community_id, pubkey) DO UPDATE
SET role = EXCLUDED.role,
    added_by = EXCLUDED.added_by,
    updated_at = now();
SQL

echo "PASS relay-owner-seeded pubkey=${pubkey}"
