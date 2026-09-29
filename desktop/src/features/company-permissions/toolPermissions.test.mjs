import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_TOOL_PERMISSION_HEAD } from "@/shared/constants/kinds";
import {
  decodeRelayToolPermissionHead,
  resolveToolPermissionAction,
  resolveToolPermissionScope,
  toolPermissionState,
} from "./toolPermissions.ts";

const RELAY_SECRET = generateSecretKey();
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const PERMISSION_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const AGENT_PUBKEY = "d".repeat(64);
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CUSTOMER_ID = "8c576119-f567-4f72-80f8-6124a430b6aa";
const ACTION_EVENT_ID = "b".repeat(64);

function headContent(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    permissionId: PERMISSION_ID,
    status: "active",
    permission: {
      schemaVersion: 1,
      permissionId: PERMISSION_ID,
      agentPubkey: AGENT_PUBKEY,
      action: "message_outsider",
      scope: { kind: "customer", id: CUSTOMER_ID },
      expiresAt: "2026-10-31T23:59:59.000Z",
    },
    grantedByPubkey: "e".repeat(64),
    changedByPubkey: "e".repeat(64),
    updatedAt: "2026-09-27T08:00:00.000Z",
    sourceActionEventId: ACTION_EVENT_ID,
    ...overrides,
  });
}

function signHead({
  secret = RELAY_SECRET,
  content = headContent(),
  tags = [
    ["d", `company:permission:${PERMISSION_ID}`],
    ["p", AGENT_PUBKEY],
  ],
} = {}) {
  return finalizeEvent(
    {
      kind: KIND_TOOL_PERMISSION_HEAD,
      created_at: 1_790_467_200,
      content,
      tags,
    },
    secret,
  );
}

test("decodeRelayToolPermissionHead verifies relay signature and exact coordinates", () => {
  const event = signHead();
  const decoded = decodeRelayToolPermissionHead(event, RELAY_PUBKEY);
  assert.equal(decoded?.head.permissionId, PERMISSION_ID);
  assert.equal(decoded?.head.permission.scope.kind, "customer");
  assert.equal(decodeRelayToolPermissionHead(event, "f".repeat(64)), null);
  assert.equal(
    decodeRelayToolPermissionHead(
      signHead({ secret: generateSecretKey() }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    decodeRelayToolPermissionHead(
      signHead({
        tags: [
          ["d", `company:permission:${PERMISSION_ID}`],
          ["p", AGENT_PUBKEY],
          ["h", CHANNEL_ID],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("tool permission state expires and revokes from the signed head", () => {
  const active = decodeRelayToolPermissionHead(signHead(), RELAY_PUBKEY);
  assert.ok(active);
  assert.equal(
    toolPermissionState(active, Date.parse("2026-10-01T00:00:00Z")),
    "Active",
  );
  assert.equal(
    toolPermissionState(active, Date.parse("2026-11-01T00:00:00Z")),
    "Expired",
  );

  const revokedContent = JSON.parse(headContent());
  revokedContent.status = "revoked";
  const revoked = decodeRelayToolPermissionHead(
    signHead({ content: JSON.stringify(revokedContent) }),
    RELAY_PUBKEY,
  );
  assert.ok(revoked);
  assert.equal(toolPermissionState(revoked), "Revoked");
});

test("scope resolution requires one exact resource and rejects ambiguous names", () => {
  const resources = {
    channels: [
      { id: CHANNEL_ID, name: "general" },
      { id: "72c0a437-f86f-4ce4-ad7a-257cafe38c06", name: "sales" },
    ],
    customers: [
      { clientId: CUSTOMER_ID, displayName: "Olive Studio" },
      {
        clientId: "1f29251d-79be-40e6-bf86-fd6179bf72d5",
        displayName: "Sales",
      },
    ],
  };
  assert.deepEqual(resolveToolPermissionScope("#general", resources), {
    kind: "channel",
    id: CHANNEL_ID,
  });
  assert.deepEqual(resolveToolPermissionScope("Olive Studio", resources), {
    kind: "customer",
    id: CUSTOMER_ID,
  });
  assert.deepEqual(
    resolveToolPermissionScope(`thread:${ACTION_EVENT_ID}`, resources),
    {
      kind: "thread",
      id: ACTION_EVENT_ID,
    },
  );
  assert.equal(resolveToolPermissionScope("Sales", resources), null);
  assert.equal(resolveToolPermissionScope("unknown resource", resources), null);
});

test("permission actions resolve only the frozen sensitive action set", () => {
  assert.equal(
    resolveToolPermissionAction("Message outsiders"),
    "message_outsider",
  );
  assert.equal(
    resolveToolPermissionAction("publish_publicly"),
    "publish_publicly",
  );
  assert.equal(
    resolveToolPermissionAction("read approved client reports"),
    null,
  );
});
