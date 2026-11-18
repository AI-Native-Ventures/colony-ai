import assert from "node:assert/strict";
import test from "node:test";

import {
  areasSearched,
  inSearchArea,
  nearbyAreas,
  nearbyAreasLeft,
  nextNearbyArea,
  shortAreaName,
} from "./discoveryCampaignAreas.ts";

function suburb(label, latitude, longitude) {
  return {
    label,
    latitude,
    longitude,
    countryCode: "ZA",
    region: "KwaZulu-Natal",
    kind: "suburb",
    boundingBox: null,
  };
}

const RICHARDS_BAY = {
  label: "Richards Bay, KwaZulu-Natal, South Africa",
  latitude: -28.7807,
  longitude: 32.0383,
  countryCode: "ZA",
  region: "KwaZulu-Natal",
  kind: "city",
  boundingBox: null,
  // Listed in the order the geocoder offered them, not by distance.
  nearby: [
    suburb("Mtunzini, KwaZulu-Natal, South Africa", -28.95, 31.75),
    suburb("Meerensee, KwaZulu-Natal, South Africa", -28.77, 32.083),
    suburb("Empangeni, KwaZulu-Natal, South Africa", -28.762, 31.893),
  ],
};

function campaign(areaIndex, pageLog = []) {
  return {
    location: RICHARDS_BAY.label,
    locationSelection: RICHARDS_BAY,
    areaIndex,
    pageLog,
  };
}

test("nearby areas are taken nearest first, whatever order they were offered in", () => {
  assert.deepEqual(
    nearbyAreas(campaign(0)).map((place) => shortAreaName(place.label)),
    ["Meerensee", "Empangeni", "Mtunzini"],
  );
});

test("a campaign searches the chosen place until it is moved to a nearby area", () => {
  const chosen = campaign(0);
  assert.equal(inSearchArea(chosen), chosen);
  assert.deepEqual(areasSearched(chosen), [RICHARDS_BAY.label]);
  assert.equal(
    nextNearbyArea(chosen)?.label,
    "Meerensee, KwaZulu-Natal, South Africa",
  );

  const second = inSearchArea(campaign(2));
  assert.equal(second.location, "Empangeni, KwaZulu-Natal, South Africa");
  assert.equal(second.locationSelection.latitude, -28.762);
  assert.equal(
    second.locationSelection.nearby,
    undefined,
    "a nearby area does not carry a list of its own",
  );
  // Only areas a page was fetched from count as searched. Pages saved before
  // areas existed carry no area and belong to the chosen place.
  assert.deepEqual(
    areasSearched(
      campaign(2, [
        { page: 1 },
        { page: 2, area: RICHARDS_BAY.label },
        { page: 3, area: "Meerensee, KwaZulu-Natal, South Africa" },
        { page: 4, area: "Meerensee, KwaZulu-Natal, South Africa" },
      ]),
    ),
    [RICHARDS_BAY.label, "Meerensee, KwaZulu-Natal, South Africa"],
    "Empangeni was reached but no page was fetched there yet",
  );
  assert.deepEqual(nearbyAreasLeft(campaign(2)), [
    "Mtunzini, KwaZulu-Natal, South Africa",
  ]);
});

test("the list of areas ends: nothing is offered after the last one", () => {
  assert.equal(nextNearbyArea(campaign(3)), null);
  assert.deepEqual(nearbyAreasLeft(campaign(3)), []);
  // A saved index past the list is read as the last area, never as a crash.
  assert.equal(
    inSearchArea(campaign(9)).location,
    "Mtunzini, KwaZulu-Natal, South Africa",
  );
});

test("a place with no nearby list has only itself", () => {
  const alone = {
    location: "South Africa",
    locationSelection: {
      ...RICHARDS_BAY,
      label: "South Africa",
      nearby: undefined,
    },
    pageLog: [],
  };
  assert.equal(inSearchArea(alone), alone);
  assert.equal(nextNearbyArea(alone), null);
  assert.deepEqual(areasSearched(alone), ["South Africa"]);
  assert.equal(
    inSearchArea({ location: "Old", locationSelection: null }).location,
    "Old",
  );
});

test("a short area name is the part before the first comma", () => {
  assert.equal(shortAreaName("Durban, KwaZulu-Natal, South Africa"), "Durban");
  assert.equal(shortAreaName("South Africa"), "South Africa");
});
