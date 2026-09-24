import assert from "node:assert/strict";
import test from "node:test";

import {
  communityCreateErrorMessage,
  communityProvisioningFromConfig,
  communityRelayUrl,
  validateCommunitySlug,
} from "./selfProvisioning.ts";

test("community provisioning config needs both the flag and a domain", () => {
  assert.deepEqual(
    communityProvisioningFromConfig({
      self_serve: true,
      domain: " Colony.Example ",
      public: true,
      max_per_owner: 7,
    }),
    {
      domain: "colony.example",
      selfServe: true,
      public: true,
      maxPerOwner: 7,
    },
  );
  assert.equal(
    communityProvisioningFromConfig({ self_serve: true, domain: " " })
      .selfServe,
    false,
  );
  assert.equal(
    communityProvisioningFromConfig({ self_serve: false, domain: "old.test" })
      .selfServe,
    false,
  );
});

test("community slug validation matches the relay's reserved and DNS rules", () => {
  assert.deepEqual(validateCommunitySlug(" North-Star-2 "), {
    slug: "north-star-2",
    error: null,
  });
  for (const name of [
    "",
    "-bad",
    "bad-",
    "bad--name",
    "bad.name",
    "admin",
    "a".repeat(64),
  ]) {
    assert.notEqual(validateCommunitySlug(name).error, null, name);
  }
});

test("new communities connect to the server-provided host over secure websockets", () => {
  assert.equal(
    communityRelayUrl("north-star.canary.example"),
    "wss://north-star.canary.example",
  );
});

test("self-provisioning errors have stable user-facing messages", () => {
  assert.match(
    communityCreateErrorMessage("community_created_retryable"),
    /Retry/,
  );
  assert.match(
    communityCreateErrorMessage("limit_reached: owner cap"),
    /limit/,
  );
  assert.match(communityCreateErrorMessage("unknown"), /Could not create/);
});
