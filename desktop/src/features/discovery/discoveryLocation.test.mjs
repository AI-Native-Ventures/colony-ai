import assert from "node:assert/strict";
import test from "node:test";

import { attachNearbyLocations } from "./discoveryLocation.ts";

function place(label, latitude, longitude, kind = "suburb", region = null) {
  return {
    label,
    latitude,
    longitude,
    countryCode: "ZA",
    region,
    kind,
    boundingBox: null,
  };
}

const CAPE_TOWN = place(
  "Cape Town, Western Cape, South Africa",
  -33.9288301,
  18.4172197,
  "city",
  "Western Cape",
);
const SEA_POINT = place(
  "Sea Point, Cape Town, Western Cape, South Africa",
  -33.9153,
  18.3877,
);
const BELLVILLE = place(
  "Bellville, Cape Town, Western Cape, South Africa",
  -33.9,
  18.6292,
);
const FOURWAYS = place(
  "Fourways, Randburg, Gauteng, South Africa",
  -26.004472,
  28.0042447,
);
const SANDTON = place("Sandton, Gauteng, South Africa", -26.1076, 28.0567);

test("owner incident: suburbs 1,200 km away are not offered as nearby areas", () => {
  // The suggestion list also holds recently used places. Fourways and Sandton
  // were shown under "Search nearby areas" on a Cape Town campaign.
  const selected = attachNearbyLocations(CAPE_TOWN, [
    FOURWAYS,
    SANDTON,
    SEA_POINT,
    CAPE_TOWN,
    BELLVILLE,
  ]);

  assert.deepEqual(
    selected.nearby.map((nearby) => nearby.label),
    [SEA_POINT.label, BELLVILLE.label],
  );
});

test("a place with no suburb in range has no nearby areas", () => {
  const selected = attachNearbyLocations(CAPE_TOWN, [FOURWAYS, SANDTON]);

  assert.equal(selected.nearby, undefined);
});

test("a recently used place does not keep the far areas saved with it", () => {
  // Recent places are stored with the nearby list they were given at the time.
  const remembered = { ...CAPE_TOWN, nearby: [FOURWAYS, SANDTON] };

  assert.equal(
    attachNearbyLocations(remembered, [FOURWAYS, SANDTON]).nearby,
    undefined,
  );
  assert.deepEqual(
    attachNearbyLocations(remembered, [FOURWAYS, SEA_POINT]).nearby.map(
      (nearby) => nearby.label,
    ),
    [SEA_POINT.label],
  );
});

test("nearby suburbs keep their order and drop the selected place and repeats", () => {
  const johannesburg = place(
    "Johannesburg, Gauteng, South Africa",
    -26.2041,
    28.0473,
    "city",
    "Gauteng",
  );
  const selected = attachNearbyLocations(johannesburg, [
    SANDTON,
    johannesburg,
    FOURWAYS,
    { ...SANDTON },
  ]);

  assert.deepEqual(
    selected.nearby.map((nearby) => nearby.label),
    [SANDTON.label, FOURWAYS.label],
  );
});
