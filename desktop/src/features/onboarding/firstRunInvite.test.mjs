import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCommunityOnboardingTransaction,
  loadCommunityOnboardingTransaction,
  startCommunityOnboarding,
  updateCommunityOnboardingTransaction,
} from "./communityOnboarding.tsx";
import {
  firstRunInviteFromTransaction,
  humanizeInviteHost,
} from "./firstRunInvite.ts";
import {
  describeInviteFailure,
  isTerminalInviteMessage,
} from "./inviteFailure.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const JOIN = {
  source: "deep-link-join",
  relayUrl: "wss://rosebank-studio-0caa3d30b084.colony.example",
  inviteCode: "v2.abc",
};

test("a host-only invite shows a humanised workspace name, never the code", () => {
  const storage = createMemoryStorage();
  const transaction = startCommunityOnboarding(JOIN, storage);
  const invite = firstRunInviteFromTransaction(transaction);
  assert.equal(invite?.businessName, "Rosebank Studio");
  assert.equal(invite?.initial, "R");
  assert.equal(invite?.code, "v2.abc");
  assert.ok(!invite?.businessName.includes("v2.abc"));
});

test("an explicit community name wins over the host", () => {
  const transaction = startCommunityOnboarding(
    { ...JOIN, communityName: "Rosebank Studio Ltd" },
    createMemoryStorage(),
  );
  assert.equal(
    firstRunInviteFromTransaction(transaction)?.businessName,
    "Rosebank Studio Ltd",
  );
});

test("humanizeInviteHost handles plain hosts, local hosts and garbage", () => {
  assert.equal(humanizeInviteHost("wss://acme.colony.example"), "Acme");
  assert.equal(humanizeInviteHost("https://north_star.example"), "North Star");
  assert.equal(humanizeInviteHost("not a url"), "your team");
  assert.equal(humanizeInviteHost("wss://0123456789ab.example"), "your team");
});

test("only join transactions that still await a claim are presented", () => {
  const storage = createMemoryStorage();
  const connect = startCommunityOnboarding(
    { source: "deep-link-connect", relayUrl: "wss://a.example" },
    storage,
  );
  assert.equal(firstRunInviteFromTransaction(connect), null);
  assert.equal(firstRunInviteFromTransaction(null), null);
  const joined = startCommunityOnboarding(
    {
      source: "first-community",
      firstCommunityPage: "join",
      relayUrl: "wss://b.example",
      inviteCode: "code",
    },
    createMemoryStorage(),
  );
  assert.ok(firstRunInviteFromTransaction(joined));
  assert.equal(
    firstRunInviteFromTransaction({ ...joined, stage: "connecting" }),
    null,
  );
});

test("a pending invite survives a restart: it is read back from storage", () => {
  const storage = createMemoryStorage();
  startCommunityOnboarding(JOIN, storage);
  const afterRestart = loadCommunityOnboardingTransaction(storage);
  assert.equal(firstRunInviteFromTransaction(afterRestart)?.code, "v2.abc");
  clearCommunityOnboardingTransaction(storage);
  assert.equal(loadCommunityOnboardingTransaction(storage), null);
});

test("a terminally failed invite claim is never persisted, so a relaunch is not trapped", () => {
  const storage = createMemoryStorage();
  const started = startCommunityOnboarding(JOIN, storage);
  const failed = updateCommunityOnboardingTransaction(
    started,
    { error: describeInviteFailure(new Error("invite_invalid")).message },
    storage,
  );
  assert.ok(failed.error);
  assert.equal(loadCommunityOnboardingTransaction(storage), null);
  assert.equal(firstRunInviteFromTransaction(failed), null);
});

test("a failed claim left by an older build is dropped on load", () => {
  for (const legacy of [
    "invite_invalid",
    "invite_expired",
    "This invite code has expired. Ask for a new one.",
    "This invite has reached its use limit. Ask for a new invite.",
  ]) {
    const storage = createMemoryStorage();
    const started = startCommunityOnboarding(JOIN, storage);
    storage.setItem(
      "buzz-community-onboarding-transaction.v1",
      JSON.stringify({ ...started, error: legacy }),
    );
    assert.equal(loadCommunityOnboardingTransaction(storage), null, legacy);
    assert.equal(
      storage.getItem("buzz-community-onboarding-transaction.v1"),
      null,
    );
  }
});

test("a retryable claim failure keeps its durable retry record", () => {
  const storage = createMemoryStorage();
  const started = startCommunityOnboarding(JOIN, storage);
  updateCommunityOnboardingTransaction(
    started,
    { error: describeInviteFailure(new TypeError("Failed to fetch")).message },
    storage,
  );
  assert.equal(loadCommunityOnboardingTransaction(storage)?.id, started.id);
});

test("a membership recovery keeps its retry record even after a terminal failure", () => {
  const storage = createMemoryStorage();
  const started = startCommunityOnboarding(
    { ...JOIN, source: "membership-recovery" },
    storage,
  );
  updateCommunityOnboardingTransaction(
    started,
    { error: "This invite code has expired. Ask for a new one." },
    storage,
  );
  assert.equal(loadCommunityOnboardingTransaction(storage)?.id, started.id);
});

test("a retried claim (error cleared) is persisted again", () => {
  const storage = createMemoryStorage();
  const started = startCommunityOnboarding(JOIN, storage);
  const failed = updateCommunityOnboardingTransaction(
    started,
    { error: "invite_invalid" },
    storage,
  );
  updateCommunityOnboardingTransaction(
    failed,
    { error: undefined, stage: "claiming" },
    storage,
  );
  assert.equal(loadCommunityOnboardingTransaction(storage)?.id, started.id);
});

test("terminal invite messages are recognised, retryable ones are not", () => {
  for (const code of ["invite_expired", "invite_exhausted", "invite_invalid"]) {
    assert.ok(
      isTerminalInviteMessage(describeInviteFailure(new Error(code)).message),
    );
  }
  assert.equal(
    isTerminalInviteMessage(
      describeInviteFailure(new TypeError("Failed to fetch")).message,
    ),
    false,
  );
});

test("invite failures use plain words and say what to do next", () => {
  for (const code of ["invite_expired", "invite_exhausted", "invite_invalid"]) {
    const failure = describeInviteFailure(new Error(code));
    assert.equal(failure.kind, "terminal");
    assert.match(failure.message, /new link/);
    assert.ok(!failure.message.includes("invite_"));
  }
  assert.equal(
    describeInviteFailure(new Error("join_policy_required")).kind,
    "policy",
  );
  assert.equal(
    describeInviteFailure(
      new Error("too many invite claim attempts, slow down"),
    ).kind,
    "retryable",
  );
  const offline = describeInviteFailure(new TypeError("Failed to fetch"));
  assert.equal(offline.kind, "retryable");
  assert.match(offline.message, /try again/);
});
