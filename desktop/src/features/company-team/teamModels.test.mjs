import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  buildTeamTreeRows,
  memberPositionDTag,
  mergeTeamMembers,
  parseMemberPositionHeadEvent,
} from "./teamModels.ts";
import { KIND_MEMBER_POSITION_HEAD } from "@/shared/constants/kinds";

const RELAY_SECRET = new Uint8Array(32).fill(12);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const OWNER = "1".repeat(64);
const EMPLOYEE = "2".repeat(64);
const HUMAN = "3".repeat(64);

function position(pubkey, managerPubkey, status = "active") {
  return {
    schemaVersion: 1,
    pubkey,
    title: "Team member",
    ...(managerPubkey ? { managerPubkey } : {}),
    kind: pubkey === EMPLOYEE ? "employee" : "human",
    status,
    ...(status === "paused" || status === "terminated"
      ? { reason: "Review in progress" }
      : {}),
    sourceActionEventId: "a".repeat(64),
    updatedAt: "2026-09-28T12:00:00Z",
  };
}

function signedPosition(head, tags = [["d", memberPositionDTag(head.pubkey)]]) {
  return finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: 1_790_000_000,
      content: JSON.stringify(head),
      tags,
    },
    RELAY_SECRET,
  );
}

test("member position parsing requires a verified relay signature and exact d-tag", () => {
  const event = signedPosition(position(EMPLOYEE, OWNER, "paused"));
  const parsed = parseMemberPositionHeadEvent(event, RELAY_PUBKEY);
  assert.equal(parsed?.head.reason, "Review in progress");
  assert.equal(parseMemberPositionHeadEvent(event, "f".repeat(64)), null);
  assert.equal(
    parseMemberPositionHeadEvent(
      signedPosition(position(EMPLOYEE, OWNER), [["d", "company:member:bad"]]),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("team membership merges real members with managed employees and excludes workers", () => {
  const members = mergeTeamMembers({
    relayMembers: [
      { pubkey: OWNER, role: "owner", addedBy: null, createdAt: "2026-01-01" },
      {
        pubkey: HUMAN,
        role: "member",
        addedBy: OWNER,
        createdAt: "2026-01-02",
      },
    ],
    relayAgents: [
      {
        pubkey: EMPLOYEE,
        ownerPubkey: OWNER,
        name: "Mina",
        agentType: "employee",
      },
      {
        pubkey: "4".repeat(64),
        ownerPubkey: EMPLOYEE,
        name: "Worker",
        agentType: "worker",
      },
    ],
    managedAgents: [
      {
        pubkey: EMPLOYEE,
        name: "Mina",
        relayUrl: "wss://relay.example",
        createdAt: "2026-01-03",
      },
      {
        pubkey: "4".repeat(64),
        name: "Worker",
        relayUrl: "wss://relay.example",
        createdAt: "2026-01-04",
      },
    ],
    positions: [],
    relayUrl: "wss://relay.example",
  });
  assert.deepEqual(
    members.map((member) => [member.pubkey, member.kind]).sort(),
    [
      [OWNER, "human"],
      [HUMAN, "human"],
      [EMPLOYEE, "employee"],
    ].sort(),
  );
});

test("a saved position does not make a non-member appear on the team", () => {
  const head = position(HUMAN, OWNER);
  const event = signedPosition(head);
  const members = mergeTeamMembers({
    relayMembers: [],
    relayAgents: [],
    managedAgents: [],
    positions: [{ head, event, dTag: memberPositionDTag(HUMAN) }],
    relayUrl: "wss://relay.example",
  });
  assert.deepEqual(members, []);
});

test("team reporting rows preserve the mixed reporting tree and reject cycles", () => {
  const positions = [OWNER, EMPLOYEE, HUMAN].map((pubkey, index) => {
    const head = position(
      pubkey,
      index === 1 ? OWNER : index === 2 ? EMPLOYEE : null,
    );
    return {
      pubkey,
      kind: head.kind,
      createdAt: `2026-01-0${index + 1}`,
      fallbackName: null,
      role: pubkey === OWNER ? "owner" : "member",
      managedAgent: null,
      relayAgent: null,
      position: { head, dTag: memberPositionDTag(pubkey), event: {} },
    };
  });
  assert.deepEqual(
    buildTeamTreeRows(positions).map((row) => [row.member.pubkey, row.depth]),
    [
      [OWNER, 0],
      [EMPLOYEE, 1],
      [HUMAN, 2],
    ],
  );
  positions[0].position.head.managerPubkey = HUMAN;
  assert.throws(() => buildTeamTreeRows(positions), /cycle/);
});
