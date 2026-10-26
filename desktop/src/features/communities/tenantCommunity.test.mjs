import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTenantCommunityId,
  pickTenantCommunityId,
  relayAuthority,
  relayHttpBase,
  resetTenantCommunityCache,
  resolveTenantCommunityId,
  TENANT_COMMUNITY_UNKNOWN_MESSAGE,
  TenantCommunityUnknownError,
} from "./tenantCommunity.ts";

const TENANT = "6550e05b-c69c-4a4c-a758-e43c4023313a";
const OTHER = "0d6f4b0a-1b1e-4c0f-8d54-2f6f5f0a9d11";
const HOST = "candidate-111-start-free-2.colony.ainative.ventures";
const RELAY = `wss://${HOST}`;

function answer(...entries) {
  return { owner_pubkey: "a".repeat(64), communities: entries };
}

function entry(id, host, extra = {}) {
  return {
    id,
    name: host,
    slug: host,
    normalized_host: host,
    owner_pubkey: "a".repeat(64),
    ...extra,
  };
}

test.beforeEach(() => resetTenantCommunityCache());

test("the relay URL gives the host the relay keys a community by, and the HTTP base", () => {
  assert.equal(relayAuthority(`wss://${HOST.toUpperCase()}`), HOST);
  assert.equal(relayAuthority("wss://x.example:443"), "x.example");
  assert.equal(relayAuthority("ws://localhost:3000"), "localhost:3000");
  assert.equal(relayAuthority("not a url"), null);
  assert.equal(relayHttpBase(RELAY), `https://${HOST}`);
  assert.equal(relayHttpBase("ws://localhost:3000"), "http://localhost:3000");
  assert.equal(relayHttpBase("ftp://x.example"), null);
  assert.equal(relayHttpBase("nonsense"), null);
});

test("only a real UUID is a tenant id, and it is lowercased", () => {
  assert.equal(parseTenantCommunityId(TENANT.toUpperCase()), TENANT);
  assert.equal(parseTenantCommunityId("dbdcf7a5"), null);
  assert.equal(parseTenantCommunityId("e2e-default-community"), null);
  assert.equal(parseTenantCommunityId(undefined), null);
});

test("the tenant id comes from the entry whose host is this community's host", () => {
  const response = answer(
    entry(OTHER, "other.colony.ainative.ventures"),
    entry(TENANT, HOST),
  );
  assert.equal(pickTenantCommunityId(response, RELAY), TENANT);
  assert.equal(
    pickTenantCommunityId(answer(entry(TENANT, HOST.toUpperCase())), RELAY),
    TENANT,
  );
});

test("nothing is guessed: no match, two matches, a bad id or a bad answer all give null", () => {
  assert.equal(
    pickTenantCommunityId(answer(entry(OTHER, "other.example")), RELAY),
    null,
  );
  assert.equal(
    pickTenantCommunityId(
      answer(entry(TENANT, HOST), entry(OTHER, HOST)),
      RELAY,
    ),
    null,
  );
  assert.equal(
    pickTenantCommunityId(answer(entry("not-a-uuid", HOST)), RELAY),
    null,
  );
  assert.equal(pickTenantCommunityId(answer(), RELAY), null);
  assert.equal(pickTenantCommunityId({}, RELAY), null);
  assert.equal(pickTenantCommunityId(null, RELAY), null);
  assert.equal(
    pickTenantCommunityId(answer(entry(TENANT, HOST)), "garbage"),
    null,
  );
});

test("the lookup goes to the community's own host and the answer is remembered", async () => {
  const bases = [];
  const lookup = async (base) => {
    bases.push(base);
    return answer(entry(TENANT, HOST));
  };
  assert.equal(await resolveTenantCommunityId(RELAY, lookup), TENANT);
  assert.equal(await resolveTenantCommunityId(RELAY, lookup), TENANT);
  assert.deepEqual(bases, [`https://${HOST}`]);
});

test("a failed lookup is a plain error and is asked again next time", async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    if (calls === 1) throw new Error("socket hang up");
    return answer(entry(TENANT, HOST));
  };
  await assert.rejects(
    () => resolveTenantCommunityId(RELAY, lookup),
    (error) =>
      error instanceof TenantCommunityUnknownError &&
      error.message === TENANT_COMMUNITY_UNKNOWN_MESSAGE,
  );
  assert.equal(await resolveTenantCommunityId(RELAY, lookup), TENANT);
  assert.equal(calls, 2);
});

test("a relay that does not list this business is an error, never a fallback id", async () => {
  const lookup = async () => answer(entry(OTHER, "other.example"));
  await assert.rejects(
    () => resolveTenantCommunityId(RELAY, lookup),
    TenantCommunityUnknownError,
  );
  await assert.rejects(
    () => resolveTenantCommunityId("nonsense", lookup),
    TenantCommunityUnknownError,
  );
});

test("a community change forgets what was learned", async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return answer(entry(TENANT, HOST));
  };
  await resolveTenantCommunityId(RELAY, lookup);
  resetTenantCommunityCache();
  await resolveTenantCommunityId(RELAY, lookup);
  assert.equal(calls, 2);
});

test("the message is plain words with no em dash", () => {
  assert.ok(
    !TENANT_COMMUNITY_UNKNOWN_MESSAGE.includes(String.fromCharCode(0x2014)),
  );
  assert.ok(!/buzz/i.test(TENANT_COMMUNITY_UNKNOWN_MESSAGE));
});
