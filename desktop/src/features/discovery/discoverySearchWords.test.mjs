// The words a campaign searches Maps with, and the request they make.
// See discoveryCampaignWords.ts and discoveryOwnerGauteng.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { searchWordsForType } from "./discoveryCampaignWords.ts";
import {
  buildDiscoverySearchPlan,
  buildSearchWords,
  discoveryCoverageKey,
  discoveryCoverageKeys,
  MAX_SEARCH_WORDS,
  plainSearchLabel,
} from "./discoverySearch.ts";

const GAUTENG = {
  label: "Gauteng, South Africa",
  latitude: -25.9363439,
  longitude: 28.0813105,
  countryCode: "ZA",
  region: null,
  kind: "region",
  boundingBox: null,
};

test("a catalogue label becomes words Maps understands, and a plain label stays as it is", () => {
  assert.equal(
    plainSearchLabel("Furniture & Upholstery Repair Businesses"),
    "Furniture Upholstery Repair",
  );
  assert.equal(
    plainSearchLabel("Home Decor & Gift Shops"),
    "Home Decor Gift Shops",
  );
  for (const plain of [
    "Breweries",
    "Bed and breakfasts",
    "Real Estate Agents and Brokers",
    "Laundry services",
    "Guesthouses and inns",
  ]) {
    assert.equal(plainSearchLabel(plain), plain);
  }
  assert.equal(plainSearchLabel("Businesses"), "Businesses", "never empty");
});

test("the words are the plain label, then the catalogue's everyday names, each once", () => {
  assert.deepEqual(
    searchWordsForType(
      "furniture-and-upholstery-repair-businesses",
      "Furniture & Upholstery Repair Businesses",
    ),
    [
      "Furniture Upholstery Repair",
      "upholsterers",
      "furniture reupholstery",
      "furniture repairers",
      "furniture restoration",
    ],
  );
  assert.deepEqual(
    buildSearchWords("Breweries", ["breweries", " Craft  breweries ", ""]),
    ["Breweries", "Craft breweries"],
  );
  assert.equal(
    buildSearchWords("A", ["b", "c", "d", "e", "f", "g"]).length,
    MAX_SEARCH_WORDS,
  );
  assert.deepEqual(
    searchWordsForType("not-in-the-catalogue", "Dog Groomers"),
    ["Dog Groomers"],
    "a type the catalogue does not hold still searches with its plain label",
  );
});

test("a campaign with words asks for the whole named area in plain words", () => {
  const plan = buildDiscoverySearchPlan({
    verticalName: "Furniture & Upholstery Repair Businesses",
    location: GAUTENG.label,
    locationSelection: GAUTENG,
    skip: 40,
    searchWords: ["Furniture Upholstery Repair", "upholsterers"],
    wordIndex: 1,
  });
  assert.equal(plan.requests.length, 1);
  const request = plan.requests[0].request;
  assert.equal(request.query, "upholsterers");
  assert.equal(request.location, "Gauteng, South Africa");
  assert.equal(request.country, "ZA");
  assert.equal(request.skip, 40);
  assert.equal(request.coordinates, undefined);
});

test("a picked tag is searched with the first plain word, not the formal label", () => {
  const plan = buildDiscoverySearchPlan({
    verticalName: "Furniture & Upholstery Repair Businesses",
    location: GAUTENG.label,
    locationSelection: GAUTENG,
    skip: 0,
    pickedTags: ["leather furniture repair"],
    tagCursors: [0],
    searchWords: ["Furniture Upholstery Repair", "upholsterers"],
    wordIndex: 1,
  });
  const request = plan.requests[0].request;
  assert.equal(
    request.query,
    "leather furniture repair Furniture Upholstery Repair",
  );
  assert.equal(request.coordinates, undefined);
});

test("a campaign from an older version keeps the request it was started with", () => {
  const plan = buildDiscoverySearchPlan({
    verticalName: "Furniture & Upholstery Repair Businesses",
    location: GAUTENG.label,
    locationSelection: GAUTENG,
    skip: 20,
  });
  const request = plan.requests[0].request;
  assert.equal(request.query, "Furniture & Upholstery Repair Businesses");
  assert.deepEqual(request.coordinates, {
    latitude: GAUTENG.latitude,
    longitude: GAUTENG.longitude,
  });
});

test("pages an older version bought never mark the new search as finished", () => {
  const base = {
    verticalId: "furniture-and-upholstery-repair-businesses",
    location: GAUTENG.label,
    locationSelection: GAUTENG,
  };
  const old = discoveryCoverageKey(base);
  const [first] = discoveryCoverageKeys({
    ...base,
    searchWords: ["Furniture Upholstery Repair", "upholsterers"],
    wordIndex: 0,
  });
  const [second] = discoveryCoverageKeys({
    ...base,
    searchWords: ["Furniture Upholstery Repair", "upholsterers"],
    wordIndex: 1,
  });
  assert.notEqual(first, old);
  assert.notEqual(second, old);
  assert.notEqual(first, second, "each word has its own cursor");
  assert.deepEqual(
    discoveryCoverageKeys(base),
    [old],
    "a campaign without words keeps its old key",
  );
});
