import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_AGENT_PLACEMENT_HEAD } from "@/shared/constants/kinds";
import {
  MAC_PLACEMENT,
  parsePlacementHead,
  pickNewestPlacements,
  placementDTag,
} from "./placementTypes.ts";

const relaySecret = generateSecretKey();
const relayPubkey = getPublicKey(relaySecret);
const AGENT = "a".repeat(64);
const OWNER = "b".repeat(64);

const content = {
  schema: 1,
  agent: AGENT,
  owner: OWNER,
  home: "cloud",
  generation: 4,
  cloudReady: true,
  configVersion: 7,
  cloudModel: "deepseek/deepseek-v4.1-flash",
  status: "asleep",
  updatedAt: 1_764_072_000,
};

function head(body, overrides = {}) {
  return finalizeEvent(
    {
      kind: KIND_AGENT_PLACEMENT_HEAD,
      content: JSON.stringify(body),
      tags: [["d", AGENT]],
      created_at: 1_764_072_000,
      ...overrides,
    },
    relaySecret,
  );
}

test("the head kind is 30682", () => {
  assert.equal(KIND_AGENT_PLACEMENT_HEAD, 30682);
});

test("parses the relay-signed head from the contract", () => {
  const parsed = parsePlacementHead(head(content), relayPubkey);
  assert.deepEqual(parsed, {
    agent: AGENT,
    owner: OWNER,
    placement: {
      home: "cloud",
      generation: 4,
      status: "asleep",
      cloudReady: true,
      cloudModel: "deepseek/deepseek-v4.1-flash",
      configVersion: 7,
    },
  });
});

test("a mac head carries a null status and null model", () => {
  const parsed = parsePlacementHead(
    head({ ...content, home: "mac", status: null, cloudModel: null }),
    relayPubkey,
  );
  assert.equal(parsed?.placement.home, "mac");
  assert.equal(parsed?.placement.status, null);
  assert.equal(parsed?.placement.cloudModel, null);
});

test("rejects a head not signed by the relay", () => {
  const stranger = generateSecretKey();
  const forged = finalizeEvent(
    {
      kind: KIND_AGENT_PLACEMENT_HEAD,
      content: JSON.stringify(content),
      tags: [["d", AGENT]],
      created_at: 1,
    },
    stranger,
  );
  assert.equal(parsePlacementHead(forged, relayPubkey), null);
});

test("rejects a d tag that is not the agent in the content", () => {
  assert.equal(
    parsePlacementHead(
      head(content, { tags: [["d", "c".repeat(64)]] }),
      relayPubkey,
    ),
    null,
  );
});

test("rejects unknown schema, unknown home, unknown status and extra keys", () => {
  for (const bad of [
    { ...content, schema: 2 },
    { ...content, home: "moon" },
    { ...content, status: "melting" },
    { ...content, surprise: true },
    { ...content, generation: -1 },
    { ...content, generation: 1.5 },
  ]) {
    assert.equal(parsePlacementHead(head(bad), relayPubkey), null);
  }
});

test("a head of the right shape that is not valid JSON is ignored", () => {
  assert.equal(
    parsePlacementHead(head(content, { content: "not json" }), relayPubkey),
    null,
  );
});

test("placementDTag is the agent pubkey, lowercased", () => {
  assert.equal(placementDTag("AB".repeat(32)), "ab".repeat(32));
});

test("absence of a head means mac at generation 0", () => {
  assert.deepEqual(MAC_PLACEMENT, {
    home: "mac",
    generation: 0,
    status: null,
    cloudReady: false,
    cloudModel: null,
    configVersion: 0,
  });
});

test("the head with the highest generation wins, not the newest created_at", () => {
  const older = head(
    { ...content, generation: 5, home: "mac", status: null },
    {
      created_at: 100,
    },
  );
  const newer = head({ ...content, generation: 4 }, { created_at: 200 });
  const picked = pickNewestPlacements([newer, older], relayPubkey);
  assert.equal(picked.get(AGENT)?.generation, 5);
  assert.equal(picked.get(AGENT)?.home, "mac");
});
