import assert from "node:assert/strict";
import test from "node:test";

import { filterOwnedBusinesses } from "./selfProvisioningApi.ts";

const owner = "a".repeat(64);
const community = (id, pubkey, name = id) => ({
  id,
  name,
  slug: id,
  normalized_host: `${id}.example.test`,
  owner_pubkey: pubkey,
});

test("filters businesses by the signed-in owner and applies saved profile names", () => {
  const communities = filterOwnedBusinesses(
    {
      owner_pubkey: owner.toUpperCase(),
      communities: [
        community("owned", owner),
        community("other", "b".repeat(64)),
      ],
    },
    owner,
    (id) => (id === "owned" ? "Saved name" : null),
  );

  assert.deepEqual(communities, [community("owned", owner, "Saved name")]);
});

test("rejects a response owned by a different identity", () => {
  assert.throws(
    () =>
      filterOwnedBusinesses(
        { owner_pubkey: "b".repeat(64), communities: [] },
        owner,
      ),
    /business_owner_mismatch/,
  );
});
