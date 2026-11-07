import assert from "node:assert/strict";
import test from "node:test";

const {
  buildQualificationOutreachList,
  filterQualificationLeads,
  matchesQualificationFilter,
} = await import("./qualifyFilter.ts");

const A = "9bb3be2c-4faa-4114-9b2d-d2ad6bd09b88";
const B = "0d13a579-215f-4c87-9f4d-646bdded3397";
const C = "e2d2b4a7-fb2c-413e-a99b-4bd5bf247a86";
const LIST = "18e47754-1cb4-4d04-a0b2-fd5ac6a90c48";

function observed(signal) {
  return {
    signal,
    state: "observed",
    value: signal,
    confidence: 0.9,
    evidenceUrls: ["https://olive.example/"],
    observedAt: 1_762_000_000,
    runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
    notCheckedReason: null,
    personalData: false,
  };
}

function head(checkedSignals, observations = []) {
  return {
    schemaVersion: 1,
    leadId: A,
    runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
    checkedSignals,
    observations,
    checkedAt: 1_762_000_000,
    sourceActionEventId: "a".repeat(64),
  };
}

const rows = [
  {
    leadId: A,
    rating: 4.6,
    reviewCount: 120,
    category: "Home goods store",
    city: "Johannesburg",
    qualification: head(
      ["NO_WEBSITE", "NO_ONLINE_BOOKING"],
      [observed("NO_WEBSITE")],
    ),
  },
  {
    leadId: B,
    rating: 4.4,
    reviewCount: 16,
    category: "Home goods store",
    city: "Johannesburg",
    qualification: { ...head(["NO_WEBSITE"]), leadId: B },
  },
  {
    leadId: C,
    rating: 4.9,
    reviewCount: 300,
    category: "Restaurant",
    city: "Cape Town",
    qualification: {
      ...head(
        ["NO_WEBSITE"],
        [
          {
            ...observed("NO_WEBSITE"),
            state: "not_checked",
            value: null,
            confidence: 0,
            evidenceUrls: [],
            notCheckedReason: "blocked_by_site",
          },
        ],
      ),
      leadId: C,
    },
  },
  {
    leadId: "dab2d4a7-fb2c-413e-a99b-4bd5bf247a86",
    rating: 4.8,
    reviewCount: 40,
    category: "Home goods store",
    city: "Johannesburg",
    qualification: null,
  },
];

test("must-have requires every stored observed signal", () => {
  assert.deepEqual(
    filterQualificationLeads(rows, {
      mustHave: ["NO_WEBSITE", "NO_ONLINE_BOOKING"],
      mustNotHave: [],
    }).map((row) => row.leadId),
    [],
  );
  assert.deepEqual(
    filterQualificationLeads(rows, {
      mustHave: ["NO_WEBSITE"],
      mustNotHave: [],
    }).map((row) => row.leadId),
    [A],
  );
});

test("must-not-have requires a completed check with no observation", () => {
  assert.deepEqual(
    filterQualificationLeads(rows, {
      mustHave: [],
      mustNotHave: ["NO_WEBSITE"],
    }).map((row) => row.leadId),
    [B],
  );
  assert.equal(
    matchesQualificationFilter(rows[3], {
      mustHave: [],
      mustNotHave: ["NO_WEBSITE"],
    }),
    false,
  );
});

test("ranges, category, and city combine with signal filters", () => {
  assert.deepEqual(
    filterQualificationLeads(rows, {
      mustHave: ["NO_WEBSITE"],
      mustNotHave: [],
      rating: { min: 4.5 },
      reviewCount: { min: 100, max: 200 },
      categories: ["HOME GOODS STORE"],
      cities: ["johannesburg"],
    }).map((row) => row.leadId),
    [A],
  );
});

test("a filter result saves the current matching IDs as an existing static list", () => {
  assert.deepEqual(
    buildQualificationOutreachList({
      listId: LIST,
      name: "No website, 4.5+ rating",
      leads: rows,
      filter: {
        mustHave: ["NO_WEBSITE"],
        mustNotHave: [],
        rating: { min: 4.5 },
      },
    }),
    {
      schemaVersion: 1,
      listId: LIST,
      op: "create",
      name: "No website, 4.5+ rating",
      source: { kind: "manual", campaignId: null },
      leadIds: [A],
    },
  );
});
