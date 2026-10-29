import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscoverySearchPlan,
  buildTagSearchQuery,
  buildSearchRequest,
  countryForLocation,
  DiscoverySearchError,
  isTransientSearchError,
  mergeDiscoverySearchResponses,
  normalizePickedTags,
  MEMBERSHIP_MESSAGE,
  parsePlace,
  parseSearchResponse,
  SEARCH_FAILED_MESSAGE,
  searchErrorFromHttp,
  UNREADABLE_RESULT_MESSAGE,
  UNSUPPORTED_SERVER_MESSAGE,
} from "./discoverySearch.ts";

test("a place needs a name; every other field is optional and typed", () => {
  assert.equal(parsePlace(null), null);
  assert.equal(parsePlace({ name: "  " }), null);
  assert.equal(parsePlace({ placeId: "x" }), null);
  const place = parsePlace({
    name: " Form & Field ",
    placeId: "p1",
    rating: "4.5",
    reviews: 12,
    phone: 5,
    website: " https://form.example ",
  });
  assert.equal(place.name, "Form & Field");
  assert.equal(place.placeId, "p1");
  assert.equal(place.rating, null);
  assert.equal(place.reviews, 12);
  assert.equal(place.phone, null);
  assert.equal(place.website, "https://form.example");
});

test("the 200 body is checked and nameless places are dropped", () => {
  const response = parseSearchResponse({
    provider: "outscraper",
    places: [{ name: "A" }, { name: "" }, 3, { name: "B" }],
    estimatedCostUsd: 0.06,
    nextSkip: 20,
  });
  assert.deepEqual(
    response.places.map((place) => place.name),
    ["A", "B"],
  );
  assert.equal(response.nextSkip, 20);
  assert.equal(response.estimatedCostUsd, 0.06);
  assert.equal(parseSearchResponse({ places: [] }).nextSkip, null);
  assert.equal(
    parseSearchResponse({ places: [], nextSkip: -4 }).nextSkip,
    null,
  );
  for (const bad of [null, "x", {}, { places: "no" }]) {
    assert.throws(
      () => parseSearchResponse(bad),
      (error) =>
        error instanceof DiscoverySearchError &&
        error.message === UNREADABLE_RESULT_MESSAGE,
    );
  }
});

test("server sentences are shown as written and carry their code", () => {
  const error = searchErrorFromHttp(503, {
    error:
      "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
    code: "discovery_not_configured",
  });
  assert.equal(
    error.message,
    "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
  );
  assert.equal(error.code, "discovery_not_configured");
  assert.equal(error.status, 503);
  assert.equal(error.transient, false);
});

test("machine-only bodies and missing bodies fall back to plain words", () => {
  assert.equal(
    searchErrorFromHttp(500, { error: "internal_error" }).message,
    SEARCH_FAILED_MESSAGE,
  );
  assert.equal(searchErrorFromHttp(500, null).message, SEARCH_FAILED_MESSAGE);
  assert.equal(
    searchErrorFromHttp(403, { error: "relay_membership_required" }).message,
    MEMBERSHIP_MESSAGE,
  );
  assert.equal(
    searchErrorFromHttp(404, {}).message,
    UNSUPPORTED_SERVER_MESSAGE,
  );
});

test("only busy, unavailable and network failures are worth a retry", () => {
  for (const code of [
    "discovery_provider_busy",
    "discovery_provider_unavailable",
    "network",
  ]) {
    assert.equal(
      isTransientSearchError(new DiscoverySearchError("x", { code })),
      true,
    );
  }
  for (const code of [
    "discovery_not_configured",
    "discovery_provider_auth",
    "discovery_provider_credits",
    null,
  ]) {
    assert.equal(
      isTransientSearchError(new DiscoverySearchError("x", { code })),
      false,
    );
  }
  assert.equal(isTransientSearchError(new Error("x")), false);
});

test("a country is only passed when the location is exactly one the server knows", () => {
  assert.equal(countryForLocation("South Africa"), "South Africa");
  assert.equal(countryForLocation("  south africa "), "South Africa");
  assert.equal(countryForLocation("Johannesburg"), undefined);
  assert.equal(countryForLocation("Johannesburg, South Africa"), undefined);
  assert.equal(countryForLocation("LA"), undefined);
  assert.equal(countryForLocation(""), undefined);
});

test("the search request pages by 20 with a clean location", () => {
  assert.deepEqual(
    buildSearchRequest({
      query: " Home Decor & Gift Shops ",
      location: " South Africa ",
      skip: 40,
    }),
    {
      query: "Home Decor & Gift Shops",
      location: "South Africa",
      country: "South Africa",
      limit: 20,
      skip: 40,
      language: "en",
    },
  );
  const city = buildSearchRequest({
    query: "Cafes",
    location: "Cape Town",
    skip: -3,
  });
  assert.equal("country" in city, false);
  assert.equal(city.skip, 0);
});

test("picked tags narrow the query and split the same 20-result page budget", () => {
  for (const [pickedTags, expectedLimits] of [
    [["wedding venue"], [20]],
    [
      ["wedding venue", "family stays"],
      [10, 10],
    ],
    [
      ["wedding venue", "family stays", "local tourism"],
      [7, 7, 6],
    ],
  ]) {
    const plan = buildDiscoverySearchPlan({
      verticalName: "Guesthouses and inns",
      location: "Cape Town",
      skip: 0,
      pickedTags,
      tagCursors: pickedTags.map(() => 0),
    });
    assert.deepEqual(
      plan.requests.map(({ request }) => request.limit),
      expectedLimits,
    );
    assert.equal(plan.totalRequestedResults, 20);
    assert.deepEqual(
      plan.requests.map(({ request }) => request.query),
      pickedTags.map((tag) => `${tag} Guesthouses and inns`),
    );
    assert.ok(
      plan.requests.every(({ request }) => request.location === "Cape Town"),
    );
  }
  assert.equal(
    buildTagSearchQuery(" wedding venue ", " Guesthouses and inns "),
    "wedding venue Guesthouses and inns",
  );
  assert.deepEqual(
    normalizePickedTags(["wedding venue", "wedding venue", " "]),
    ["wedding venue"],
  );
});

test("picked-tag pages keep independent cursors and stop exhausted searches", () => {
  const plan = buildDiscoverySearchPlan({
    verticalName: "Guesthouses and inns",
    location: "Cape Town",
    skip: 20,
    pickedTags: ["wedding venue", "family stays", "local tourism"],
    tagCursors: [7, null, 6],
  });
  assert.deepEqual(
    plan.requests.map(({ tagIndex, request }) => [
      tagIndex,
      request.limit,
      request.skip,
    ]),
    [
      [0, 10, 7],
      [2, 10, 6],
    ],
  );
  assert.equal(plan.totalRequestedResults, 20);
});

test("merged tag results deduplicate by place id and add request costs", () => {
  const merged = mergeDiscoverySearchResponses(
    [
      {
        provider: "outscraper",
        places: [
          parsePlace({ name: "A", placeId: "p1" }),
          parsePlace({ name: "No id" }),
        ],
        estimatedCostUsd: 0.35,
        nextSkip: 10,
      },
      {
        provider: "outscraper",
        places: [
          parsePlace({ name: "Duplicate A", placeId: "p1" }),
          parsePlace({ name: "No id" }),
        ],
        estimatedCostUsd: 0.35,
        nextSkip: 10,
      },
    ],
    20,
  );
  assert.deepEqual(
    merged.places.map((place) => place.name),
    ["A", "No id", "No id"],
  );
  assert.equal(merged.estimatedCostUsd, 0.7);
  assert.equal(merged.nextSkip, 20);
});
