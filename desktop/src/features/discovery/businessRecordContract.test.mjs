import assert from "node:assert/strict";
import test from "node:test";

import {
  latestByDTag,
  proposalConversionIds,
} from "./businessRecordContract.ts";
import {
  countPeopleRoles,
  countVerticals,
  searchCatalogue,
} from "./taxonomy.ts";

function event(id, created_at, dTag, content = "{}") {
  return {
    id,
    created_at,
    kind: 30642,
    tags: [["d", dTag]],
    content,
    pubkey: "a".repeat(64),
    sig: "b".repeat(128),
  };
}

test("latestByDTag chooses the newest valid record and a stable id tie-break", () => {
  const rows = latestByDTag(
    [
      event("a", 10, "record:one", '{"value":1}'),
      event("z", 11, "record:one", '{"value":2}'),
      event("b", 11, "record:one", '{"value":3}'),
      event("c", 12, "record:one", "not-json"),
    ],
    (item) => {
      try {
        return JSON.parse(item.content);
      } catch {
        return null;
      }
    },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].event.id, "z");
  assert.deepEqual(rows[0].record, { value: 2 });
});

test("proposal conversion ids stay fixed for retries of the same version", async () => {
  const first = await proposalConversionIds("proposal-a", "version-1");
  const retry = await proposalConversionIds("proposal-a", "version-1");
  const revision = await proposalConversionIds("proposal-a", "version-2");

  assert.deepEqual(retry, first);
  assert.notDeepEqual(revision, first);
  for (const id of Object.values(first)) {
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});

test("frozen discovery taxonomy counts and filters match the handoff", () => {
  assert.equal(countVerticals(), 531);
  assert.equal(countPeopleRoles(), 96);
  assert.equal(
    searchCatalogue("businesses", "home decor", null).some(
      (row) => row.id === "home-decor-gift-shops",
    ),
    true,
  );
  assert.equal(
    searchCatalogue("people", "accountant", null).some((row) =>
      row.name.toLocaleLowerCase().includes("accountant"),
    ),
    true,
  );
});
