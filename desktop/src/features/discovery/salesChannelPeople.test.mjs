import assert from "node:assert/strict";
import test from "node:test";

import { pickSalesChannelPeople } from "./salesChannelPeople.ts";

const ME = "a".repeat(64);
const ADMIN = "b".repeat(64);
const THIS_MAC_SCOUT = "5".repeat(64);
const THIS_MAC_AYA = "6".repeat(64);
const OLD_SCOUT_1 = "7".repeat(64);
const OLD_SCOUT_2 = "8".repeat(64);

const managedAgent = (pubkey) => ({ pubkey });

function employee(pubkey, overrides = {}) {
  return {
    pubkey,
    kind: "employee",
    managedAgent: null,
    relayAgent: { pubkey },
    position: null,
    ...overrides,
  };
}

const relayMembers = [
  { pubkey: ME, role: "owner" },
  { pubkey: ADMIN, role: "admin" },
  { pubkey: "c".repeat(64), role: "member" },
];

test("the Sales channel gets the agents this Mac runs, not every Scout on the account", () => {
  const people = pickSalesChannelPeople({
    selfPubkey: ME,
    relayMembers,
    teamMembers: [
      employee(OLD_SCOUT_1),
      employee(THIS_MAC_SCOUT, { managedAgent: managedAgent(THIS_MAC_SCOUT) }),
      employee(OLD_SCOUT_2),
      employee(THIS_MAC_AYA, { managedAgent: managedAgent(THIS_MAC_AYA) }),
    ],
  });

  assert.deepEqual(people.employees, [THIS_MAC_SCOUT, THIS_MAC_AYA]);
  assert.deepEqual(people.leaders, [ADMIN]);
});

test("a business with no agent on this Mac adds no AI employees", () => {
  const people = pickSalesChannelPeople({
    selfPubkey: ME,
    relayMembers,
    teamMembers: [employee(OLD_SCOUT_1), employee(OLD_SCOUT_2)],
  });

  assert.deepEqual(people.employees, []);
});

test("humans and terminated employees are not added", () => {
  const people = pickSalesChannelPeople({
    selfPubkey: ME,
    relayMembers,
    teamMembers: [
      employee(ADMIN, { kind: "human" }),
      employee(THIS_MAC_AYA, {
        managedAgent: managedAgent(THIS_MAC_AYA),
        position: { head: { status: "terminated" } },
      }),
      employee(THIS_MAC_SCOUT, {
        managedAgent: managedAgent(THIS_MAC_SCOUT),
        position: { head: { status: "paused" } },
      }),
    ],
  });

  assert.deepEqual(people.employees, [THIS_MAC_SCOUT]);
});

test("the person setting the channel up is never listed twice", () => {
  const people = pickSalesChannelPeople({
    selfPubkey: ME.toUpperCase(),
    relayMembers,
    teamMembers: [employee(ME, { managedAgent: managedAgent(ME) })],
  });

  assert.deepEqual(people.leaders, [ADMIN]);
  assert.deepEqual(people.employees, []);
});
