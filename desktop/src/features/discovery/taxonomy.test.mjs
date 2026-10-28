import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  countVerticals,
  findVertical,
  industryTaxonomy,
  verticalTypes,
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

test("every industry carries what the v4 screens read: description and sectors", () => {
  for (const industry of industryTaxonomy) {
    assert.ok(industry.description?.length > 10, industry.id);
    assert.ok(industry.sectors.length > 0, industry.id);
    const sectorIds = new Set(industry.sectors.map((sector) => sector.id));
    assert.ok(industry.verticals.length > 0, industry.id);
    for (const vertical of industry.verticals) {
      assert.ok(
        sectorIds.has(vertical.sectorId),
        `${industry.id}/${vertical.id}`,
      );
    }
  }
});

test("every type carries canonical id, definition, aliases, industries, sectors and ISIC codes", () => {
  assert.equal(verticalTypes.length, 869);
  const industryIds = new Set(industryTaxonomy.map((industry) => industry.id));
  for (const type of verticalTypes) {
    assert.ok(type.label && type.definition, type.id);
    assert.ok(type.industries.length > 0, type.id);
    for (const hub of type.industries) {
      assert.ok(industryIds.has(hub), `${type.id} in unknown ${hub}`);
      assert.ok(type.sectors[hub], `${type.id} has no sector in ${hub}`);
    }
    assert.ok(Array.isArray(type.isic));
  }
  const inn = findVertical("guesthouses-and-inns");
  assert.deepEqual(inn.industries, [
    "hospitality-accommodation",
    "travel-tourism",
  ]);
  assert.deepEqual(inn.isic, ["5520"]);
  assert.ok(inn.aliases.includes("guest houses"));
  assert.equal(inn.description, inn.definition);
});

test("an old vertical's market note is kept; a retired id finds its type", () => {
  const stores = findVertical("department-stores");
  assert.ok(stores.note, "department stores keeps its old note");
  assert.equal(stores.description, stores.note);
  assert.equal(
    findVertical("pest-control-services").id,
    "pest-control-companies",
  );
  assert.equal(findVertical("no-such-vertical"), undefined);
});

test("people roles search is unchanged", () => {
  assert.ok(
    searchCatalogue("people", "accountant", null).some((row) =>
      row.name.toLowerCase().includes("accountant"),
    ),
  );
});
