import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_ASK_HEAD } from "@/shared/constants/kinds";
import { askIdFromAction, decodeRelayAskHead } from "./askRecords.ts";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const THREAD_ROOT = "a".repeat(64);
const RELAY_SECRET = generateSecretKey();
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const OTHER_SECRET = generateSecretKey();

function headContent(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    askId: ASK_ID,
    status: "open",
    askerPubkey: "d".repeat(64),
    createdAt: "2026-09-27T08:00:00Z",
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "general",
      title: "Approve the launch plan",
      threadRootEventId: THREAD_ROOT,
      addresseePubkey: "e".repeat(64),
      decideBy: "2026-09-28T08:00:00Z",
    },
    resolution: null,
    cancellation: null,
    sourceActionEventId: "b".repeat(64),
    ...overrides,
  });
}

function signHead({
  secret = RELAY_SECRET,
  content = headContent(),
  tags = [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
    ["e", THREAD_ROOT],
  ],
} = {}) {
  return finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: 1_790_467_200,
      content,
      tags,
    },
    secret,
  );
}

test("decodeRelayAskHead accepts a verified relay head at its channel coordinate", () => {
  const event = signHead();
  const decoded = decodeRelayAskHead(event, RELAY_PUBKEY, CHANNEL_ID);

  assert.equal(decoded?.channelId, CHANNEL_ID);
  assert.equal(decoded?.head.askId, ASK_ID);
  assert.equal(decoded?.head.ask.type, "approval");
  assert.equal(decoded?.event.id, event.id);
});

test("decodeRelayAskHead rejects user signatures, duplicate coordinates, and wrong channels", () => {
  const validTags = [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
  ];
  assert.equal(
    decodeRelayAskHead(signHead({ secret: OTHER_SECRET }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead({ tags: [...validTags, ["h", CHANNEL_ID]] }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead(),
      RELAY_PUBKEY,
      "9dae0116-799b-5071-a0a8-fdd30a91a35d",
    ),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead({
        tags: [validTags[0], ["d", `channel:${CHANNEL_ID}:ask:other`]],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("decodeRelayAskHead rejects a tampered signature and reports malformed signed content", () => {
  const event = signHead();
  const tamperedEvent = JSON.parse(JSON.stringify(event));
  tamperedEvent.content = `${tamperedEvent.content} `;
  assert.equal(decodeRelayAskHead(tamperedEvent, RELAY_PUBKEY), null);
  assert.throws(
    () => decodeRelayAskHead(signHead({ content: "{" }), RELAY_PUBKEY),
    /invalid ask head/i,
  );
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: headContent({ status: "new" }) }),
        RELAY_PUBKEY,
      ),
    /unsupported shape/i,
  );
});

test("askIdFromAction reads create commands only", () => {
  assert.equal(
    askIdFromAction(JSON.stringify({ action: "create", askId: ASK_ID })),
    ASK_ID,
  );
  assert.equal(
    askIdFromAction(JSON.stringify({ action: "respond", askId: ASK_ID })),
    null,
  );
  assert.equal(askIdFromAction("not json"), null);
});
