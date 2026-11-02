import assert from "node:assert/strict";
import test from "node:test";

import {
  alignSkip,
  buildDiscoverySearchPlan,
  cursorHasPages,
  QUERY_PLACE_CEILING,
  SEARCH_PAGE_SIZE,
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

test("a search request never carries a skip that is not a multiple of 20, or a short page", () => {
  for (const [skip, expected] of [
    [0, 0],
    [7, 0],
    [14, 0],
    [21, 20],
    [39, 20],
    [40, 40],
    [Number.NaN, 0],
    [-5, 0],
  ]) {
    assert.equal(alignSkip(skip), expected, `skip ${skip}`);
    const request = buildSearchRequest({
      query: "Restaurants",
      location: "Johannesburg",
      skip,
    });
    assert.equal(request.skip, expected, `request skip ${skip}`);
    assert.equal(request.limit, SEARCH_PAGE_SIZE);
  }
  assert.equal(cursorHasPages(0), true);
  assert.equal(cursorHasPages(QUERY_PLACE_CEILING - 20), true);
  assert.equal(cursorHasPages(QUERY_PLACE_CEILING), false);
  assert.equal(cursorHasPages(null), false);
});

test("picked tags narrow the query and take turns, one full page of 20 each", () => {
  for (const pickedTags of [
    ["wedding venue"],
    ["wedding venue", "family stays"],
    ["wedding venue", "family stays", "local tourism"],
  ]) {
    const queries = [];
    for (let turn = 0; turn < pickedTags.length * 2; turn += 1) {
      const plan = buildDiscoverySearchPlan({
        verticalName: "Guesthouses and inns",
        location: "Cape Town",
        skip: 0,
        pickedTags,
        tagCursors: pickedTags.map(() => 0),
        turn,
      });
      assert.equal(plan.requests.length, 1, "one request per page");
      const { request } = plan.requests[0];
      assert.equal(request.limit, 20);
      assert.equal(request.skip, 0);
      assert.equal(request.location, "Cape Town");
      assert.equal(plan.totalRequestedResults, 20);
      queries.push(request.query);
    }
    const expected = pickedTags.map((tag) => `${tag} Guesthouses and inns`);
    assert.deepEqual(queries, [...expected, ...expected]);
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

test("no plan, with or without tags, ever asks for a skip that is not a multiple of 20", () => {
  const tagSets = [[], ["steak"], ["steak", "sushi", "pizza"]];
  for (const pickedTags of tagSets) {
    for (const skip of [0, 7, 14, 21, 33, 100, 399]) {
      for (const cursor of [0, 7, 14, 21, 100, 399]) {
        for (let turn = 0; turn < 6; turn += 1) {
          const plan = buildDiscoverySearchPlan({
            verticalName: "Restaurants",
            location: "Johannesburg",
            skip,
            pickedTags,
            tagCursors: pickedTags.map(() => cursor),
            turn,
          });
          for (const { request } of plan.requests) {
            assert.equal(request.skip % 20, 0, `skip ${request.skip}`);
            assert.equal(request.limit, 20);
          }
        }
      }
    }
  }
});

test("picked-tag pages keep independent cursors, skip spent tags and stop at the 400 place ceiling", () => {
  const plan = buildDiscoverySearchPlan({
    verticalName: "Guesthouses and inns",
    location: "Cape Town",
    skip: 60,
    pickedTags: ["wedding venue", "family stays", "local tourism"],
    tagCursors: [20, null, 40],
    turn: 1,
  });
  assert.deepEqual(
    plan.requests.map(({ tagIndex, request }) => [
      tagIndex,
      request.limit,
      request.skip,
    ]),
    [[2, 20, 40]],
  );

  const spent = buildDiscoverySearchPlan({
    verticalName: "Guesthouses and inns",
    location: "Cape Town",
    skip: 0,
    pickedTags: ["wedding venue", "family stays"],
    tagCursors: [QUERY_PLACE_CEILING, null],
    turn: 0,
  });
  assert.deepEqual(
    spent.requests,
    [],
    "no paid request once every query is spent",
  );
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
