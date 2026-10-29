import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  discoveryTagFitLabel,
  discoveryTagFitWeight,
  compareDiscoveryTagFit,
  groupDiscoveryTags,
  matchDiscoveryTags,
  websiteDomainWords,
} from "./discoveryTags.ts";
import {
  relatedVerticalsFor,
  resetVerticalTagsForTest,
  setVerticalTags,
  verticalTypes,
} from "./taxonomy.ts";

const dataUrl = new URL("./data/vertical-tags.json", import.meta.url);
const tagData = JSON.parse(fs.readFileSync(dataUrl, "utf8"));
const typeId = "guesthouses-and-inns";

function place(overrides = {}) {
  return {
    placeId: "place-1",
    name: "Wedding venues",
    category: "Venue",
    subtypes: "Private events",
    address: null,
    city: null,
    state: null,
    country: null,
    phone: null,
    website: "https://florist.example.co.za/about",
    email: null,
    rating: null,
    reviews: null,
    latitude: null,
    longitude: null,
    mapsUrl: null,
    description: null,
    businessStatus: null,
    ...overrides,
  };
}

function withTagData(data, run) {
  setVerticalTags(data);
  try {
    run();
  } finally {
    resetVerticalTagsForTest();
  }
}

test("lead tags use taxonomy stemming and weight one picked tag twice", () => {
  const fixture = {
    ...tagData,
    [typeId]: {
      tags: [
        ["wedding venue", "specialty"],
        ["private events", "service"],
        ["florist", "product"],
        ["corporate retreats", "customer"],
      ],
      search: [],
      sa: [],
      related: [],
    },
  };
  withTagData(fixture, () => {
    const matches = matchDiscoveryTags(typeId, ["wedding venue"], place());
    assert.deepEqual(
      matches.map(({ tag, picked }) => [tag, picked]),
      [
        ["wedding venue", true],
        ["florist", false],
        ["private events", false],
      ],
    );
    assert.equal(discoveryTagFitWeight(matches), 4);
    assert.equal(discoveryTagFitLabel(matches), "Strong fit");
    assert.deepEqual(
      groupDiscoveryTags(matches).map(({ kind, tags }) => [
        kind,
        tags.map((entry) => entry.tag),
      ]),
      [
        ["product", ["florist"]],
        ["service", ["private events"]],
        ["specialty", ["wedding venue"]],
      ],
    );
  });
});

test("Best fit ranks tag evidence before the old provider score", () => {
  const picked = [{ tag: "wedding venue", kind: "specialty", picked: true }];
  assert.ok(compareDiscoveryTagFit(picked, 30, [], 99) < 0);
  assert.ok(compareDiscoveryTagFit([], 70, [], 50) < 0);
});

test("website matching reads domain words and unmatched leads have no chips or fit label", () => {
  assert.equal(
    websiteDomainWords("https://www.florist.example.co.za/about"),
    "florist example co za",
  );
  const fixture = {
    ...tagData,
    [typeId]: {
      tags: [["wedding venue", "specialty"]],
      search: [],
      sa: [],
      related: [],
    },
  };
  withTagData(fixture, () => {
    const matches = matchDiscoveryTags(
      typeId,
      [],
      place({
        name: "Auto Repairs",
        category: "Mechanic",
        subtypes: null,
        website: "https://auto.example.co.za",
      }),
    );
    assert.deepEqual(matches, []);
    assert.equal(discoveryTagFitLabel(matches), null);
  });
});

test("related types drop removed ids and self references and cap the list at six", () => {
  const currentIds = verticalTypes
    .filter((type) => type.id !== typeId)
    .map((type) => type.id);
  const requested = [typeId, "removed-type", ...currentIds.slice(0, 8)];
  const fixture = {
    ...tagData,
    [typeId]: { ...tagData[typeId], related: requested },
  };
  withTagData(fixture, () => {
    const related = relatedVerticalsFor(typeId);
    assert.equal(related.length, 6);
    assert.ok(related.every((type) => type.id !== typeId));
    assert.ok(related.every((type) => currentIds.includes(type.id)));
    assert.deepEqual(
      related.map((type) => type.id),
      currentIds.slice(0, 6),
    );
  });
});
