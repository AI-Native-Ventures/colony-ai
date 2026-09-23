import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fixtureFile = process.argv[2] ?? process.env.COLONY_ELECTRON_FIXTURE_FILE;
if (!fixtureFile) {
  throw new Error("Pass the generated relay identity fixture file");
}

const document = JSON.parse(readFileSync(fixtureFile, "utf8"));
const identities = document.identities ?? {};
const publicKeys = Object.values(identities).map((identity) => {
  if (!/^[0-9a-f]{64}$/u.test(identity.publicKey ?? "")) {
    throw new Error("Generated fixture contains an invalid public key");
  }
  return identity.publicKey;
});
if (publicKeys.length === 0) {
  throw new Error("Generated fixture contains no identities");
}

const expectedMemberships = publicKeys.length * 2;
const valueRows = publicKeys
  .map((publicKey) => `(decode('${publicKey}', 'hex'))`)
  .join(",\n  ");
const sql = `
BEGIN;
CREATE TEMP TABLE fixture_keys (pubkey BYTEA) ON COMMIT DROP;
INSERT INTO fixture_keys(pubkey) VALUES ${valueRows};

WITH target_channels AS (
  SELECT c.id AS community_id, ch.id AS channel_id
  FROM communities c
  JOIN channels ch ON ch.community_id = c.id
  WHERE lower(c.host) IN ('localhost:3000', 'localhost:3001')
    AND ch.id = '9f28288a-d724-587a-9709-92dc7f967110'::uuid
    AND ch.name = 'general'
)
INSERT INTO channel_members
  (community_id, channel_id, pubkey, role, invited_by)
  SELECT target.community_id, target.channel_id, fixture.pubkey,
       'member', decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
FROM target_channels target
CROSS JOIN fixture_keys fixture
ON CONFLICT DO NOTHING;

DO $colony_electron_fixture_memberships$
DECLARE
  active_memberships BIGINT;
BEGIN
  SELECT count(*) INTO active_memberships
  FROM channel_members cm
  JOIN communities c ON c.id = cm.community_id
  JOIN channels ch ON ch.community_id = c.id AND ch.id = cm.channel_id
  WHERE lower(c.host) IN ('localhost:3000', 'localhost:3001')
    AND ch.id = '9f28288a-d724-587a-9709-92dc7f967110'::uuid
    AND ch.name = 'general'
    AND cm.pubkey IN (SELECT pubkey FROM fixture_keys)
    AND cm.removed_at IS NULL;

  IF active_memberships <> ${expectedMemberships} THEN
    RAISE EXCEPTION 'Expected ${expectedMemberships} active fixture memberships, found %', active_memberships;
  END IF;
END
$colony_electron_fixture_memberships$;
COMMIT;
`;

const host = process.env.COLONY_ELECTRON_DB_HOST ?? "127.0.0.1";
const port = process.env.COLONY_ELECTRON_DB_PORT ?? "5432";
const user = process.env.COLONY_ELECTRON_DB_USER ?? "buzz";
const password = process.env.COLONY_ELECTRON_DB_PASSWORD ?? "buzz_dev";
const database = process.env.COLONY_ELECTRON_DB_NAME ?? "buzz";
const container = process.env.COLONY_ELECTRON_DB_CONTAINER ?? "buzz-postgres";
const psql = process.env.COLONY_ELECTRON_PSQL ?? "psql";
const args = [
  "-h",
  host,
  "-p",
  port,
  "-U",
  user,
  "-d",
  database,
  "-v",
  "ON_ERROR_STOP=1",
  "-qAt",
];
const local = spawnSync(psql, args, {
  encoding: "utf8",
  env: { ...process.env, PGPASSWORD: password },
  input: sql,
  timeout: 30_000,
});

let result = local;
if (local.error?.code === "ENOENT" && !process.env.COLONY_ELECTRON_PSQL) {
  result = spawnSync(
    process.env.COLONY_ELECTRON_DOCKER ?? "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${password}`,
      container,
      "psql",
      "-U",
      user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    { encoding: "utf8", input: sql, timeout: 30_000 },
  );
}

if (result.error || result.status !== 0) {
  throw new Error(
    `Could not seed generated relay memberships: ${result.error?.message ?? result.stderr.trim()}`,
  );
}
console.log(
  `Seeded ${publicKeys.length} generated identities in general for localhost:3000 and localhost:3001 before relay startup`,
);
