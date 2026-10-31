import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KEY_RESCUE_BUTTON_LABEL,
  KEY_RESCUE_DONE_TEXT,
  KEY_RESCUE_OFFER_TEXT,
  keyRescueCardState,
} from "./keyRescueModel.ts";

const SCOUT = { pubkey: "aa".repeat(32), name: "Scout" };
const NOVA = { pubkey: "bb".repeat(32), name: "Nova" };

const offered = {
  offer: true,
  lockedAgents: [SCOUT, NOVA],
  attempt: null,
};

const attempt = (outcome, agentsMoved = []) => ({
  attemptedAtUnix: 1,
  outcome,
  agentsMoved,
  deviceSecretsMoved: 0,
  identity: "notInKeychain",
});

describe("key rescue card", () => {
  it("says what it does in plain words and names the button", () => {
    assert.match(KEY_RESCUE_OFFER_TEXT, /still in the Mac Keychain/u);
    assert.match(KEY_RESCUE_OFFER_TEXT, /move them once/u);
    assert.match(KEY_RESCUE_OFFER_TEXT, /choose Always Allow/u);
    assert.equal(KEY_RESCUE_BUTTON_LABEL, "Move my agents' keys");
    for (const text of [KEY_RESCUE_OFFER_TEXT, KEY_RESCUE_DONE_TEXT]) {
      assert.ok(!text.includes("—"), "no em dashes");
    }
  });

  it("shows nothing until the host says to offer it", () => {
    assert.deepEqual(keyRescueCardState(undefined), { kind: "hidden" });
    assert.deepEqual(keyRescueCardState(null), { kind: "hidden" });
    assert.deepEqual(
      keyRescueCardState({ offer: false, lockedAgents: [], attempt: null }),
      { kind: "hidden" },
    );
  });

  it("offers the rescue on the agents page", () => {
    assert.deepEqual(keyRescueCardState(offered), {
      kind: "offer",
      text: KEY_RESCUE_OFFER_TEXT,
    });
  });

  it("offers it in a conversation only with a locked agent", () => {
    assert.equal(
      keyRescueCardState(offered, { scopePubkeys: [SCOUT.pubkey] }).kind,
      "offer",
    );
    assert.equal(
      keyRescueCardState(offered, { scopePubkeys: ["cc".repeat(32)] }).kind,
      "hidden",
    );
  });

  it("after a denied attempt lists the agents and the delete and add again path, with no button", () => {
    const state = keyRescueCardState({
      offer: false,
      lockedAgents: [SCOUT, NOVA],
      attempt: attempt("denied"),
    });
    assert.equal(state.kind, "failed");
    assert.deepEqual(state.agentNames, ["Scout", "Nova"]);
    assert.match(state.headline, /did not let Colony read/u);
    assert.match(
      state.guidance,
      /Delete each of these agents and add it again/u,
    );
  });

  it("in a conversation lists only that conversation's locked agents", () => {
    const state = keyRescueCardState(
      {
        offer: false,
        lockedAgents: [SCOUT, NOVA],
        attempt: attempt("partial", ["cc".repeat(32)]),
      },
      { scopePubkeys: [NOVA.pubkey.toUpperCase()] },
    );
    assert.equal(state.kind, "failed");
    assert.deepEqual(state.agentNames, ["Nova"]);
  });

  it("confirms a successful move once, then goes quiet", () => {
    const moved = {
      offer: false,
      lockedAgents: [],
      attempt: attempt("rescued", [SCOUT.pubkey]),
    };
    assert.equal(keyRescueCardState(moved, { justMoved: true }).kind, "done");
    assert.equal(keyRescueCardState(moved).kind, "hidden");
  });
});
