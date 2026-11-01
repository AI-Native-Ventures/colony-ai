import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureOnboardingProfile,
  otherWorkspaceRelays,
} from "./onboardingProfile.ts";
const key = "colony-signup-name.v1:owner@example.com";
const pendingKey = "colony-pending-profile.v1:identity";
function setup({
  existing = false,
  name = "Amina",
  failure = false,
  pending = null,
} = {}) {
  const values = new Map([[key, name]]);
  if (pending) values.set(pendingKey, JSON.stringify(pending));
  const writes = [];
  const deps = {
    read: async () => ({ pubkey: "identity", hasProfileEvent: existing }),
    account: async () => ({ pubkey: "identity", email: "owner@example.com" }),
    write: async (input) => {
      writes.push(input);
      if (failure) throw new Error("offline");
      return input;
    },
    storage: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    },
  };
  return { values, writes, deps };
}
test("first entry publishes the signup name through the production kind:0 seam", async () => {
  const s = setup();
  await ensureOnboardingProfile(() => true, s.deps);
  assert.deepEqual(s.writes, [{ displayName: "Amina" }]);
  assert.equal(s.values.get(key), "Amina");
});
test("a name and photo picked after an advanced sign-in are published, then cleared", async () => {
  const s = setup({
    pending: {
      displayName: "Lerato Molefe",
      avatarUrl: "data:image/webp;base64,AAAA",
    },
  });
  await ensureOnboardingProfile(() => true, s.deps);
  assert.deepEqual(s.writes, [
    { displayName: "Lerato Molefe", avatarUrl: "data:image/webp;base64,AAAA" },
  ]);
  assert.equal(s.values.has(pendingKey), false);
});
test("a failed publish keeps the pending profile for retry", async () => {
  const s = setup({ failure: true, pending: { displayName: "Lerato Molefe" } });
  await assert.rejects(
    ensureOnboardingProfile(() => true, s.deps),
    /offline/,
  );
  assert.equal(s.values.has(pendingKey), true);
});
test("missing name falls back to email local part", async () => {
  const s = setup({ name: "" });
  await ensureOnboardingProfile(() => true, s.deps);
  assert.deepEqual(s.writes, [{ displayName: "owner" }]);
});
test("an existing profile is preserved", async () => {
  const s = setup({ existing: true });
  await ensureOnboardingProfile(() => true, s.deps);
  assert.equal(s.writes.length, 0);
});
test("failed publication retains the durable name for retry", async () => {
  const s = setup({ failure: true });
  await assert.rejects(
    ensureOnboardingProfile(() => true, s.deps),
    /offline/,
  );
  assert.equal(s.values.get(key), "Amina");
});
test("cancelled lookup never publishes a profile", async () => {
  const s = setup();
  await assert.rejects(
    ensureOnboardingProfile(() => false, s.deps),
    /cancelled/,
  );
  assert.equal(s.writes.length, 0);
});

test("a stalled profile read returns a retryable failure without publishing", async () => {
  const s = setup();
  s.deps.read = () => new Promise(() => {});
  s.deps.timeoutMs = 10;
  await assert.rejects(
    ensureOnboardingProfile(() => true, s.deps),
    /could not be loaded/,
  );
  assert.equal(s.writes.length, 0);
  assert.equal(s.values.get(key), "Amina");
});

test("an unlinked identity never publishes the placeholder You", async () => {
  const s = setup({ name: "" });
  s.deps.read = async () => ({
    pubkey: "identity",
    hasProfileEvent: false,
    displayName: "You",
  });
  s.deps.account = async () => null;
  await ensureOnboardingProfile(() => true, s.deps);
  assert.equal(s.writes.length, 0);
});

// A person who already has a name and picture in another workspace.
const FIRST = "wss://colony.example.com";
const NEW = "wss://socket.example.com";
function carrying({ sources, copy, existing = false } = {}) {
  const s = setup({ existing, name: "" });
  s.reads = [];
  s.copies = [];
  s.relaysAsked = [];
  s.deps.carryDependencies = {
    relays: (active) => {
      s.relaysAsked.push(active);
      return otherWorkspaceRelays(
        [{ relayUrl: FIRST }, { relayUrl: NEW }],
        active,
      );
    },
    read: async ({ relayUrl, expectedPubkey }) => {
      s.reads.push({ relayUrl, expectedPubkey });
      const found = sources[relayUrl];
      if (found instanceof Error) throw found;
      return found ?? { pubkey: expectedPubkey, hasProfileEvent: false };
    },
    copyAvatar: async (input) => {
      s.copies.push(input);
      return copy ? copy(input) : "https://socket.example.com/media/copied.png";
    },
    write: s.deps.write,
  };
  return s;
}
const basheer = {
  pubkey: "identity",
  hasProfileEvent: true,
  displayName: "Basheer Phiri",
  avatarUrl: "https://colony.example.com/media/photo.png",
};

test("a new workspace starts with the name and picture from the first one, copied into its own media", async () => {
  const s = carrying({ sources: { [FIRST]: basheer } });
  await ensureOnboardingProfile(() => true, s.deps, NEW);
  assert.deepEqual(s.relaysAsked, [NEW]);
  assert.deepEqual(s.reads, [{ relayUrl: FIRST, expectedPubkey: "identity" }]);
  assert.deepEqual(s.copies, [
    {
      sourceRelayUrl: FIRST,
      avatarUrl: "https://colony.example.com/media/photo.png",
    },
  ]);
  // The email-derived name never reaches the new workspace.
  assert.deepEqual(s.writes, [
    {
      displayName: "Basheer Phiri",
      avatarUrl: "https://socket.example.com/media/copied.png",
    },
  ]);
});

test("joining by invite carries the same profile through the same seam", async () => {
  // Create and join both finish through ensureOnboardingProfile with the
  // workspace's own relay; the joined relay is excluded from the sources.
  const s = carrying({
    sources: { [FIRST]: basheer },
    copy: () => "https://socket.example.com/media/joined.png",
  });
  await ensureOnboardingProfile(() => true, s.deps, `${NEW}/`);
  assert.deepEqual(
    s.reads.map((read) => read.relayUrl),
    [FIRST],
  );
  assert.equal(
    s.writes[0].avatarUrl,
    "https://socket.example.com/media/joined.png",
  );
});

test("a profile already set in the workspace is never overwritten", async () => {
  const s = carrying({ sources: { [FIRST]: basheer }, existing: true });
  await ensureOnboardingProfile(() => true, s.deps, NEW);
  assert.equal(s.writes.length, 0);
  assert.equal(s.reads.length, 0);
});

test("a picture that cannot be copied is dropped but the name still carries", async () => {
  const s = carrying({
    sources: { [FIRST]: basheer },
    copy: () => {
      throw new Error("avatar download failed");
    },
  });
  await ensureOnboardingProfile(() => true, s.deps, NEW);
  assert.deepEqual(s.writes, [{ displayName: "Basheer Phiri" }]);
});

test("about and job title travel with the profile", async () => {
  const s = carrying({
    sources: {
      [FIRST]: {
        ...basheer,
        avatarUrl: null,
        about: "Builds Colony",
        jobTitle: "Founder",
      },
    },
  });
  await ensureOnboardingProfile(() => true, s.deps, NEW);
  assert.deepEqual(s.writes, [
    {
      displayName: "Basheer Phiri",
      about: "Builds Colony",
      jobTitle: "Founder",
    },
  ]);
  assert.equal(s.copies.length, 0);
});

test("unreadable or unnamed workspaces are skipped, then the account name is used", async () => {
  const s = carrying({
    sources: { [FIRST]: new Error("relay unreachable") },
  });
  s.values.set(key, "Amina");
  await ensureOnboardingProfile(() => true, s.deps, NEW);
  assert.deepEqual(s.writes, [{ displayName: "Amina" }]);
  const unnamed = carrying({
    sources: { [FIRST]: { ...basheer, displayName: "  " } },
  });
  unnamed.values.set(key, "Amina");
  await ensureOnboardingProfile(() => true, unnamed.deps, NEW);
  assert.deepEqual(unnamed.writes, [{ displayName: "Amina" }]);
});

test("a cancelled setup never publishes a carried profile", async () => {
  const s = carrying({ sources: { [FIRST]: basheer } });
  let current = true;
  s.deps.carryDependencies.copyAvatar = async () => {
    current = false;
    return "https://socket.example.com/media/copied.png";
  };
  await assert.rejects(
    ensureOnboardingProfile(() => current, s.deps, NEW),
    /cancelled/,
  );
  assert.equal(s.writes.length, 0);
});

test("other workspace relays skip the active one, once each", () => {
  assert.deepEqual(
    otherWorkspaceRelays(
      [
        { relayUrl: "colony.example.com" },
        { relayUrl: "wss://Socket.example.com/" },
        { relayUrl: "wss://colony.example.com" },
      ],
      "wss://socket.example.com",
    ),
    ["wss://colony.example.com"],
  );
  assert.deepEqual(otherWorkspaceRelays([], NEW), []);
});
