import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOwnerLabel,
  profileLookupsEqual,
  resolveIdentityLabels,
  resolveUserLabel,
} from "./identity.ts";

const OWNER_PUBKEY =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const SCOUT_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SCOUT_B =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const VIEWER_PUBKEY =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

const summary = (over = {}) => ({
  displayName: "Ada",
  avatarUrl: "https://x/a.png",
  nip05Handle: "ada@x",
  ownerPubkey: null,
  isAgent: false,
  ...over,
});

test("formatOwnerLabel prefers the owner’s authored labels and never a key", () => {
  assert.equal(
    formatOwnerLabel(OWNER_PUBKEY, null, {
      [OWNER_PUBKEY]: summary({ displayName: "baxen" }),
    }),
    "baxen",
  );
  assert.equal(
    formatOwnerLabel(OWNER_PUBKEY, "c".repeat(64), {
      [OWNER_PUBKEY]: summary({
        nip05Handle: "baxen@relay",
        displayName: null,
      }),
    }),
    "baxen@relay",
  );
  assert.equal(formatOwnerLabel(OWNER_PUBKEY, "c".repeat(64), {}), "teammate");
});

test("formatOwnerLabel calls the viewer-owned agent's owner you", () => {
  assert.equal(formatOwnerLabel(OWNER_PUBKEY, OWNER_PUBKEY, {}), "you");
});

test("formatOwnerLabel returns null when verified ownership is absent", () => {
  assert.equal(formatOwnerLabel(null, OWNER_PUBKEY, {}), null);
});

test("resolveUserLabel never falls back to a raw or compact public key", () => {
  // A missing profile is neutral. The UI cannot safely infer that an
  // unprofiled public key belongs to a person, so the common fallback stays
  // the explicit AI-employee label required by every rendering surface.
  assert.equal(
    resolveUserLabel({ pubkey: OWNER_PUBKEY, profiles: {} }),
    "AI employee",
  );
  assert.equal(
    resolveUserLabel({
      pubkey: OWNER_PUBKEY,
      profiles: {},
      isAgent: true,
    }),
    "AI employee",
  );
  // A provided fallback name still wins over the key form.
  assert.equal(
    resolveUserLabel({
      pubkey: OWNER_PUBKEY,
      profiles: {},
      fallbackName: "legacy relay agent",
    }),
    "legacy relay agent",
  );
  // A resolved display name wins over everything.
  assert.equal(
    resolveUserLabel({
      pubkey: OWNER_PUBKEY,
      profiles: { [OWNER_PUBKEY]: summary({ displayName: "baxen" }) },
    }),
    "baxen",
  );
  // A legacy server record can itself carry a key-derived name. It must be
  // treated exactly like an absent name rather than reintroduced by a later
  // rendering surface.
  assert.equal(
    resolveUserLabel({
      pubkey: OWNER_PUBKEY,
      fallbackName: OWNER_PUBKEY,
      profiles: {
        [OWNER_PUBKEY]: summary({
          displayName: `npub1${"q".repeat(58)}`,
          nip05Handle: null,
        }),
      },
    }),
    "AI employee",
  );
});

test("shared agent labels distinguish a teammate's Scout by owner", () => {
  const labels = resolveIdentityLabels([
    {
      pubkey: SCOUT_A,
      currentPubkey: VIEWER_PUBKEY,
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
      ownerProfiles: {
        [OWNER_PUBKEY]: summary({ displayName: "Basheer Khan" }),
      },
    },
    {
      pubkey: SCOUT_B,
      currentPubkey: VIEWER_PUBKEY,
      isAgent: true,
      ownerPubkey: VIEWER_PUBKEY,
      fallbackName: "Scout",
      ownerProfiles: {
        [VIEWER_PUBKEY]: summary({ displayName: "Zaina Patel" }),
      },
    },
  ]);

  const teammateScout = labels.get(SCOUT_A);
  assert.equal(teammateScout?.text, "Scout (Basheer)");
  assert.equal(teammateScout?.primary, "Scout");
  assert.equal(teammateScout?.ownerSuffix, "Basheer");
  assert.equal(teammateScout?.ownerTooltip, "Basheer Khan");
  assert.equal(labels.get(SCOUT_B)?.text, "Scout");
});

test("same-owner duplicate agents get a short ordinal only then", () => {
  const labels = resolveIdentityLabels([
    {
      pubkey: SCOUT_A,
      currentPubkey: OWNER_PUBKEY,
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
    },
    {
      pubkey: SCOUT_B,
      currentPubkey: OWNER_PUBKEY,
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
    },
  ]);
  assert.equal(labels.get(SCOUT_A)?.text, "Scout 1");
  assert.equal(labels.get(SCOUT_B)?.text, "Scout 2");
});

test("a preferred local duplicate keeps the bare agent name", () => {
  const labels = resolveIdentityLabels([
    {
      pubkey: SCOUT_A,
      currentPubkey: OWNER_PUBKEY,
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
    },
    {
      pubkey: SCOUT_B,
      currentPubkey: OWNER_PUBKEY,
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
      preferUnqualifiedDuplicate: true,
    },
  ]);

  assert.equal(labels.get(SCOUT_A)?.text, "Scout 2");
  assert.equal(labels.get(SCOUT_B)?.text, "Scout");
  assert.equal(labels.get(SCOUT_B)?.duplicateOrdinal, null);
});

test("missing and departed owners stay neutral, and a rename updates the label", () => {
  const missingOwner = resolveIdentityLabels([
    {
      pubkey: SCOUT_A,
      currentPubkey: "d".repeat(64),
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
    },
  ]).get(SCOUT_A);
  assert.equal(missingOwner?.text, "Scout (teammate)");

  const renamedOwner = resolveIdentityLabels([
    {
      pubkey: SCOUT_A,
      currentPubkey: "d".repeat(64),
      isAgent: true,
      ownerPubkey: OWNER_PUBKEY,
      fallbackName: "Scout",
      ownerProfiles: {
        [OWNER_PUBKEY]: summary({ displayName: "Zaina Patel" }),
      },
    },
  ]).get(SCOUT_A);
  assert.equal(renamedOwner?.text, "Scout (Zaina)");
});

test("profileLookupsEqual: same reference is equal", () => {
  const a = { p1: summary() };
  assert.equal(profileLookupsEqual(a, a), true);
});

test("profileLookupsEqual: distinct objects, identical values are equal", () => {
  assert.equal(profileLookupsEqual({ p1: summary() }, { p1: summary() }), true);
});

test("profileLookupsEqual: different key count is not equal", () => {
  assert.equal(
    profileLookupsEqual({ p1: summary() }, { p1: summary(), p2: summary() }),
    false,
  );
});

test("profileLookupsEqual: same count, different keys is not equal", () => {
  assert.equal(
    profileLookupsEqual({ p1: summary() }, { p2: summary() }),
    false,
  );
});

test("profileLookupsEqual: a changed field is not equal", () => {
  for (const field of [
    "displayName",
    "avatarUrl",
    "nip05Handle",
    "ownerPubkey",
    "isAgent",
  ]) {
    assert.equal(
      profileLookupsEqual(
        { p1: summary() },
        { p1: summary({ [field]: field === "isAgent" ? true : "changed" }) },
      ),
      false,
      `field ${field} should break equality`,
    );
  }
});

test("profileLookupsEqual: two empty lookups are equal", () => {
  assert.equal(profileLookupsEqual({}, {}), true);
});

// Render-count proof for the Tier-1 typing-storm fix (#1533 discipline).
// MessageRow re-renders iff `prev.profiles === next.profiles` fails, so the
// stabiliser's job is: hold the reference across value-equal re-derives (the
// per-keystroke churn) and release it only on a real value change. This
// replays the exact ChannelScreen ref idiom against a sequence of freshly
// built lookups and asserts reference identity == render decision.
function makeStabiliser() {
  let ref;
  let first = true;
  return (raw) => {
    if (first || !profileLookupsEqual(ref, raw)) {
      ref = raw;
    }
    first = false;
    return ref;
  };
}

test("stabiliser: value-equal re-derives keep the same reference (no re-render)", () => {
  const stabilise = makeStabiliser();
  // Each entry is a fresh object identity — exactly what a users-batch re-key
  // produces on every keystroke-adjacent typing event.
  const first = stabilise({ p1: summary() });
  const churnA = stabilise({ p1: summary() });
  const churnB = stabilise({ p1: summary() });
  assert.equal(churnA, first, "value-equal churn must not swap the reference");
  assert.equal(churnB, first, "repeated churn must not swap the reference");
});

test("stabiliser: a real profile change swaps the reference (re-render fires)", () => {
  const stabilise = makeStabiliser();
  const first = stabilise({ p1: summary() });
  const changed = stabilise({ p1: summary({ displayName: "Grace" }) });
  assert.notEqual(
    changed,
    first,
    "a real value change must swap the reference",
  );
  // ...and then re-stabilises around the new value.
  const held = stabilise({ p1: summary({ displayName: "Grace" }) });
  assert.equal(held, changed, "must re-stabilise around the new value");
});
