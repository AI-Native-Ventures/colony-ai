import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  countVerticals,
  industryTaxonomy,
  resolveVerticalId,
  searchCatalogue,
} from "./taxonomy.ts";

const legacy = JSON.parse(
  fs.readFileSync(
    new URL("./data/source/legacy-industry-taxonomy.json", import.meta.url),
    "utf8",
  ),
);

function ids(query, industryId = null) {
  return searchCatalogue("businesses", query, industryId).map((row) => row.id);
}

const FINDS = [
  ["guest house", "guesthouses-and-inns"],
  ["Guest Houses", "guesthouses-and-inns"],
  ["guesthouse", "guesthouses-and-inns"],
  ["guesthouses", "guesthouses-and-inns"],
  ["B&B", "bed-and-breakfasts"],
  ["b and b", "bed-and-breakfasts"],
  ["bed and breakfast", "bed-and-breakfasts"],
  ["bed & breakfasts", "bed-and-breakfasts"],
  ["lodge", "cabins-and-holiday-lodge-operators"],
  ["lodges", "cabins-and-holiday-lodge-operators"],
  ["pharmacy", "pharmacies-and-drugstores"],
  ["pharmacies", "pharmacies-and-drugstores"],
  ["chemist", "pharmacies-and-drugstores"],
  ["drug store", "pharmacies-and-drugstores"],
];

for (const [query, id] of FINDS) {
  test(`"${query}" finds ${id}`, () => {
    assert.ok(ids(query).includes(id), `${query} missed ${id}`);
  });
}

test("a nonsense word finds nothing", () => {
  assert.deepEqual(ids("qzxvwk"), []);
  assert.deepEqual(searchCatalogue("people", "qzxvwk", null), []);
});

test("a name hit ranks before an alias or definition hit", () => {
  assert.equal(ids("guesthouses")[0], "guesthouses-and-inns");
  assert.equal(ids("bed and breakfast")[0], "bed-and-breakfasts");
  const hotels = ids("hotel");
  assert.equal(hotels[0], "hotels");
});

test("a short symbol query does not match the whole catalogue", () => {
  assert.ok(ids("b&b").length < countVerticals() / 20);
});

test("the catalogue is the 51 industry, 869 type v4 list", () => {
  assert.equal(industryTaxonomy.length, 51);
  assert.equal(countVerticals(), 869);
});

test("a type in several industries is listed once in a search, in each industry on its own", () => {
  const rows = searchCatalogue("businesses", "guest house", null);
  assert.equal(
    rows.filter((row) => row.id === "guesthouses-and-inns").length,
    1,
  );
  for (const hub of ["hospitality-accommodation", "travel-tourism"]) {
    assert.ok(
      searchCatalogue("businesses", "", hub).some(
        (row) => row.id === "guesthouses-and-inns" && row.parentId === hub,
      ),
    );
  }
});

test("an empty query lists everything; the industry filter narrows it", () => {
  assert.equal(searchCatalogue("businesses", "  ", null).length, 869);
  const rows = searchCatalogue("businesses", "", "travel-tourism");
  assert.ok(rows.length > 10);
  assert.ok(rows.every((row) => row.parentId === "travel-tourism"));
});

test("every row has a note: the old market note where it carried over, else the definition", () => {
  const rows = searchCatalogue("businesses", "", null);
  assert.ok(rows.every((row) => row.description.length > 0));
  const pharmacies = rows.find((row) => row.id === "pharmacies-and-drugstores");
  assert.match(pharmacies.description, /pharmac/i);
});

test("old vertical ids saved in campaigns and leads still resolve", () => {
  const known = new Set(
    searchCatalogue("businesses", "", null).map((row) => row.id),
  );
  const oldIds = legacy.flatMap((category) =>
    category.verticals.map((vertical) => vertical.id),
  );
  assert.equal(oldIds.length, 531);
  let resolved = 0;
  for (const oldId of oldIds) {
    const next = resolveVerticalId(oldId);
    if (next === undefined) continue;
    resolved += 1;
    assert.ok(known.has(next), `${oldId} -> ${next} is not a catalogue type`);
  }
  assert.ok(resolved >= 40, `only ${resolved} old ids resolve`);
  // Bridge pair and a retired canonical id.
  assert.equal(resolveVerticalId("department-stores"), "department-stores");
  assert.equal(
    resolveVerticalId("pest-control-services"),
    "pest-control-companies",
  );
  assert.equal(
    resolveVerticalId("guesthouses-and-inns"),
    "guesthouses-and-inns",
  );
  assert.equal(resolveVerticalId("no-such-vertical"), undefined);
});

test("people roles search is unchanged", () => {
  assert.ok(
    searchCatalogue("people", "accountant", null).some((row) =>
      row.name.toLowerCase().includes("accountant"),
    ),
  );
});
