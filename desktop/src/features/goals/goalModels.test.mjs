import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { goalDTag, parseGoalDTag, parseGoalHeadEvent } from "./goalModels.ts";

const RELAY_SECRET = new Uint8Array(32).fill(2);
const OTHER_SECRET = new Uint8Array(32).fill(3);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const COMMUNITY_ID = "123e4567-e89b-12d3-a456-426614174000";
const GOAL_ID = "123e4567-e89b-12d3-a456-426614174001";

function signedHead({
  goalId = GOAL_ID,
  status = "active",
  tags = [["d", goalDTag(COMMUNITY_ID, GOAL_ID)]],
  content,
  secret = RELAY_SECRET,
} = {}) {
  const head = {
    schemaVersion: 1,
    goalId,
    status,
    title: "Prepare the October plan",
    sourceActionEventId: "a".repeat(64),
    ...(status === "deleted"
      ? {}
      : {
          goal: {
            schemaVersion: 1,
            goalId,
            title: "Prepare the October plan",
            ownerPubkey: "b".repeat(64),
            doneCondition: "The client approved the plan",
            linkedChannelIds: [],
          },
        }),
  };
  return finalizeEvent(
    {
      kind: 30642,
      created_at: 1_790_000_000,
      content: content ?? JSON.stringify(head),
      tags,
    },
    secret,
  );
}

test("goal d-tags retain community and goal UUIDs", () => {
  const dTag = goalDTag(COMMUNITY_ID, GOAL_ID);
  assert.equal(dTag, `company:${COMMUNITY_ID}:goal:${GOAL_ID}`);
  assert.deepEqual(parseGoalDTag(dTag), {
    communityId: COMMUNITY_ID,
    goalId: GOAL_ID,
  });
  assert.equal(parseGoalDTag(`${dTag}:extra`), null);
});

test("goal head parsing accepts only verified relay-signed global heads", () => {
  const event = signedHead();
  const parsed = parseGoalHeadEvent(event, RELAY_PUBKEY);
  assert.equal(parsed?.head.goalId, GOAL_ID);
  assert.equal(parsed?.communityId, COMMUNITY_ID);

  assert.equal(parseGoalHeadEvent(event, getPublicKey(OTHER_SECRET)), null);
  assert.equal(
    parseGoalHeadEvent(signedHead({ secret: OTHER_SECRET }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    parseGoalHeadEvent(signedHead({ tags: [] }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    parseGoalHeadEvent(
      signedHead({
        tags: [
          ["d", goalDTag(COMMUNITY_ID, GOAL_ID)],
          ["h", COMMUNITY_ID],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseGoalHeadEvent(
      signedHead({ content: "tampered after signing" }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("deleted goal heads keep only their readable title and identity", () => {
  const parsed = parseGoalHeadEvent(
    signedHead({ status: "deleted" }),
    RELAY_PUBKEY,
  );
  assert.equal(parsed?.head.status, "deleted");
  assert.equal(parsed?.head.title, "Prepare the October plan");
  assert.equal(parsed?.head.goal, undefined);
  assert.equal(parsed?.head.progress, undefined);
});
