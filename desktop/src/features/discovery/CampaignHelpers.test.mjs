import assert from "node:assert/strict";
import test from "node:test";

import { runDescription, runTitle } from "./CampaignHelpers.ts";

const NOTE =
  "The results you approved were used after 5 pages. 41 were already in your Leads and are not charged. Keep searching for the other 50? Find more continues this search at no extra cost.";

function campaign(overrides = {}) {
  return {
    status: "complete",
    endReason: "approved_budget",
    endNote: NOTE,
    count: 50,
    target: 100,
    failureReason: null,
    ...overrides,
  };
}

test("a search that stopped short of the request is not titled complete", () => {
  const stoppedShort = campaign();

  assert.equal(runTitle(stoppedShort), "Found 50 of 100");
  assert.equal(
    runDescription(stoppedShort),
    NOTE,
    "the title holds both numbers, so the description is only the question",
  );
});

test("a search that found everything asked for is complete", () => {
  const full = campaign({
    count: 100,
    endReason: "target_reached",
    endNote: null,
  });

  assert.equal(runTitle(full), "Search complete");
  assert.equal(runDescription(full), "100 prospects found · 100 requested");
});

test("a search the provider ended keeps the complete title and its reason", () => {
  const ended = campaign({
    count: 12,
    endReason: "provider_end",
    endNote: "Google Maps has no more results for this search.",
  });

  assert.equal(runTitle(ended), "Search complete");
  assert.equal(
    runDescription(ended),
    "12 prospects found · 100 requested. Google Maps has no more results for this search.",
  );
});

test("an approved-results stop without a note still shows both numbers once", () => {
  const noNote = campaign({ endNote: null });

  assert.equal(runTitle(noNote), "Found 50 of 100");
  assert.equal(runDescription(noNote), "50 prospects found · 100 requested");
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
  }
});
