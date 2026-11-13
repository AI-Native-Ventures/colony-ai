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

const DURBAN = {
  label: "Durban, KwaZulu-Natal, South Africa",
  latitude: -29.8587,
  longitude: 31.0218,
  countryCode: "ZA",
  region: "KwaZulu-Natal",
  kind: "city",
  boundingBox: null,
  // Listed in the order the geocoder offered them, not by distance.
  nearby: [
    suburb("Ballito, KwaZulu-Natal, South Africa", -29.539, 31.2144),
    suburb("Umhlanga, KwaZulu-Natal, South Africa", -29.7256, 31.0849),
    suburb("Pinetown, KwaZulu-Natal, South Africa", -29.8167, 30.85),
  ],
};

function campaign(areaIndex, pageLog = []) {
  return {
    location: DURBAN.label,
    locationSelection: DURBAN,
    areaIndex,
    pageLog,
  };
}

test("nearby areas are taken nearest first, whatever order they were offered in", () => {
  assert.deepEqual(
    nearbyAreas(campaign(0)).map((place) => shortAreaName(place.label)),
    ["Umhlanga", "Pinetown", "Ballito"],
  );
});

test("a campaign searches the chosen place until it is moved to a nearby area", () => {
  const chosen = campaign(0);
  assert.equal(inSearchArea(chosen), chosen);
  assert.deepEqual(areasSearched(chosen), [DURBAN.label]);
  assert.equal(
    nextNearbyArea(chosen)?.label,
    "Umhlanga, KwaZulu-Natal, South Africa",
  );

  const second = inSearchArea(campaign(2));
  assert.equal(second.location, "Pinetown, KwaZulu-Natal, South Africa");
  assert.equal(second.locationSelection.latitude, -29.8167);
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
        { page: 2, area: DURBAN.label },
        { page: 3, area: "Umhlanga, KwaZulu-Natal, South Africa" },
        { page: 4, area: "Umhlanga, KwaZulu-Natal, South Africa" },
      ]),
    ),
    [DURBAN.label, "Umhlanga, KwaZulu-Natal, South Africa"],
    "Pinetown was reached but no page was fetched there yet",
  );
  assert.deepEqual(nearbyAreasLeft(campaign(2)), [
    "Ballito, KwaZulu-Natal, South Africa",
  ]);
});

test("the list of areas ends: nothing is offered after the last one", () => {
  assert.equal(nextNearbyArea(campaign(3)), null);
  assert.deepEqual(nearbyAreasLeft(campaign(3)), []);
  // A saved index past the list is read as the last area, never as a crash.
  assert.equal(
    inSearchArea(campaign(9)).location,
    "Ballito, KwaZulu-Natal, South Africa",
  );
});

test("a place with no nearby list has only itself", () => {
  const alone = {
    location: "South Africa",
    locationSelection: { ...DURBAN, label: "South Africa", nearby: undefined },
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
