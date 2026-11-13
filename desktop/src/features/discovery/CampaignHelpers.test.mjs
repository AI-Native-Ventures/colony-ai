import assert from "node:assert/strict";
import test from "node:test";

import {
  canFindMore,
  runDescription,
  runTitle,
  searchedAreasLabel,
} from "./CampaignHelpers.ts";

const DURBAN = "Durban, KwaZulu-Natal, South Africa";
const UMHLANGA = "Umhlanga, KwaZulu-Natal, South Africa";
const PINETOWN = "Pinetown, KwaZulu-Natal, South Africa";
const BALLITO = "Ballito, KwaZulu-Natal, South Africa";
const WESTVILLE = "Westville, KwaZulu-Natal, South Africa";

function campaign(overrides = {}) {
  return {
    status: "complete",
    endReason: "approved_budget",
    endNote: "A long reason that belongs in Run details, not on the card.",
    location: DURBAN,
    count: 50,
    target: 100,
    pagesFetched: 5,
    skippedDuplicates: 41,
    areasSearched: [DURBAN],
    nearbyAreasLeft: [],
    failureReason: null,
    ...overrides,
  };
}

test("the owner's Durban search: the card asks one short question before any nearby area", () => {
  const durban = campaign({
    count: 68,
    target: 200,
    pagesFetched: 6,
    skippedDuplicates: 28,
    endReason: "provider_end",
    nearbyAreasLeft: [UMHLANGA, PINETOWN, BALLITO],
  });

  assert.equal(runTitle(durban), "Found 68 of 200");
  assert.equal(
    runDescription(durban),
    "Durban has no more. Find more in Umhlanga, Pinetown and 1 more nearby area?",
  );
  assert.equal(canFindMore(durban), true);
  assert.equal(searchedAreasLabel(durban), DURBAN);
});

test("the nearby areas are named in full when there are one or two", () => {
  const base = { endReason: "provider_end", areasSearched: [DURBAN] };
  assert.equal(
    runDescription(campaign({ ...base, nearbyAreasLeft: [UMHLANGA] })),
    "Durban has no more. Find more in Umhlanga?",
  );
  assert.equal(
    runDescription(
      campaign({ ...base, nearbyAreasLeft: [UMHLANGA, PINETOWN] }),
    ),
    "Durban has no more. Find more in Umhlanga and Pinetown?",
  );
  assert.equal(
    runDescription(
      campaign({
        ...base,
        nearbyAreasLeft: [UMHLANGA, PINETOWN, BALLITO, WESTVILLE],
      }),
    ),
    "Durban has no more. Find more in Umhlanga, Pinetown and 2 more nearby areas?",
  );
});

test("part way through the nearby areas the card names the area that just ran out", () => {
  const partWay = campaign({
    endReason: "provider_end",
    areasSearched: [DURBAN, UMHLANGA],
    nearbyAreasLeft: [PINETOWN],
  });

  assert.equal(
    runDescription(partWay),
    "Umhlanga has no more. Find more in Pinetown?",
  );
  assert.equal(searchedAreasLabel(partWay), "Durban + 1 nearby area");
  assert.equal(
    searchedAreasLabel(
      campaign({ areasSearched: [DURBAN, UMHLANGA, PINETOWN] }),
    ),
    "Durban + 2 nearby areas",
  );
});

test("when nothing is left to search the card says so and offers no Find more", () => {
  const alone = campaign({ endReason: "provider_end" });
  assert.equal(
    runDescription(alone),
    "Durban has no more. Try another business type or area.",
  );
  assert.equal(canFindMore(alone), false);

  const everywhere = campaign({
    endReason: "provider_end",
    areasSearched: [DURBAN, UMHLANGA, PINETOWN],
  });
  assert.equal(
    runDescription(everywhere),
    "Durban and its nearby areas have no more. Try another business type.",
  );
  assert.equal(canFindMore(everywhere), false);
});

test("the approved results are used: leads already owned are free, and the card asks for the rest", () => {
  const stoppedShort = campaign();

  assert.equal(runTitle(stoppedShort), "Found 50 of 100");
  assert.equal(
    runDescription(stoppedShort),
    "41 were already in your Leads and are free. Find the other 50?",
  );
  assert.equal(canFindMore(stoppedShort), true);
  assert.equal(
    runDescription(campaign({ skippedDuplicates: 0 })),
    "Find the other 50?",
  );
});

test("the page limit ends a search whatever else is left", () => {
  const capped = campaign({
    pagesFetched: 25,
    endReason: "provider_end",
    nearbyAreasLeft: [UMHLANGA],
  });

  assert.equal(
    runDescription(capped),
    "This search reached its limit of 25 pages. Try another business type or area.",
  );
  assert.equal(canFindMore(capped), false);
});

test("repeating results can be tried again from the next page", () => {
  const repeating = campaign({ endReason: "provider_repeat" });

  assert.equal(
    runDescription(repeating),
    "Results started repeating. Find more tries the next page.",
  );
  assert.equal(canFindMore(repeating), true);
});

test("a search that found everything asked for is complete", () => {
  const full = campaign({
    count: 100,
    endReason: "target_reached",
    endNote: null,
  });

  assert.equal(runTitle(full), "Search complete");
  assert.equal(runDescription(full), "100 prospects found · 100 requested");
  assert.equal(canFindMore(full), false);
});

test("an older saved search without a recorded reason keeps its saved note", () => {
  const legacy = campaign({ endReason: null, endNote: "Saved note." });

  assert.equal(runTitle(legacy), "Found 50 of 100");
  assert.equal(runDescription(legacy), "Saved note.");
  assert.equal(canFindMore(legacy), false);
});

test("every other run state keeps its own title", () => {
  const titles = {
    running: "Finding prospects",
    paused: "Search paused",
    failed: "Search interrupted",
    cancelled: "Search cancelled",
  };

  for (const [status, title] of Object.entries(titles)) {
    assert.equal(runTitle(campaign({ status })), title, status);
    assert.equal(canFindMore(campaign({ status })), false, status);
  }
});
