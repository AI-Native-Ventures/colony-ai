import assert from "node:assert/strict";
import test from "node:test";

import {
  mapMentionCandidateToSuggestion,
  pickDefaultAgentSuggestion,
} from "./mentionSuggestionMapping.ts";

const OWNER = "a".repeat(64);

function candidate(overrides = {}) {
  return {
    kind: "identity",
    pubkey: "b".repeat(64),
    isAgent: true,
    isMember: true,
    ownerPubkey: OWNER,
    ...overrides,
  };
}

function suggestion(overrides = {}, agentProvenanceReady = true) {
  return mapMentionCandidateToSuggestion({
    agentProvenanceReady,
    candidate: candidate(overrides),
    currentPubkey: OWNER,
    label: "Carl",
  });
}

test("labels Desktop-managed agent identities as managed here", () => {
  assert.equal(
    suggestion({ isManagedAgent: true }).agentProvenance,
    "managed-here",
  );
});

test("labels same-owner relay agent identities as managed elsewhere", () => {
  assert.equal(suggestion().agentProvenance, "managed-elsewhere");
});

test("fails closed while the managed-agent directory is unresolved", () => {
  assert.equal(
    suggestion({ isManagedAgent: true }, false).agentProvenance,
    undefined,
  );
  assert.equal(suggestion({}, false).agentProvenance, undefined);
});

test("does not attribute another owner's agent to a device", () => {
  assert.equal(
    suggestion({ ownerPubkey: "c".repeat(64) }).agentProvenance,
    undefined,
  );
});

test("does not attribute people or personas to a device", () => {
  assert.equal(suggestion({ isAgent: false }).agentProvenance, undefined);
  assert.equal(
    suggestion({ kind: "persona", pubkey: undefined }).agentProvenance,
    undefined,
  );
});

test("the default agent for the always-address shortcut is the Scout this Mac runs", () => {
  const thisMac = "5".repeat(64);
  const picked = pickDefaultAgentSuggestion({
    activePersonaIds: new Set(),
    agentProvenanceReady: true,
    candidates: [
      candidate({
        displayName: "Scout",
        isActiveAgent: true,
        pubkey: "7".repeat(64),
      }),
      candidate({
        displayName: "Scout",
        isManagedAgent: true,
        isMember: false,
        pubkey: thisMac,
      }),
    ],
    currentPubkey: OWNER,
    recentMentionPubkeys: ["7".repeat(64)],
  });

  assert.equal(picked?.pubkey, thisMac);
  assert.equal(picked?.agentProvenance, "managed-here");
});
