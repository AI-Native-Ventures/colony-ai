import assert from "node:assert/strict";
import test from "node:test";

import {
  discoveryCoverUrl,
  shouldShowDiscoveryCover,
} from "./discoveryCovers.ts";

test("builds the canonical fixed-width Discovery cover URL", () => {
  assert.equal(
    discoveryCoverUrl("travel-tourism", 640),
    "https://colony.global/discovery/covers/v1/travel-tourism-640.webp",
  );
  assert.equal(
    discoveryCoverUrl("guest-houses", 1200),
    "https://colony.global/discovery/covers/v1/guest-houses-1200.webp",
  );
});

test("uses the placeholder when an image id is missing or the image fails", () => {
  assert.equal(discoveryCoverUrl(null, 640), null);
  assert.equal(discoveryCoverUrl("bad/id", 640), null);
  assert.equal(shouldShowDiscoveryCover("travel-tourism", 640, null), true);
  assert.equal(
    shouldShowDiscoveryCover(
      "travel-tourism",
      640,
      "https://colony.global/discovery/covers/v1/travel-tourism-640.webp",
    ),
    false,
  );
});
