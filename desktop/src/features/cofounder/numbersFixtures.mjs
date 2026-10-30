import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_NUMBERS_HEAD } from "@/shared/constants/kinds";
import { SCORECARD_D_TAG, goalDTag, reviewDTag } from "./numbersRecords.ts";

export const GOAL_ID = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";
export const REVIEW_DATE = "2026-10-30";
export const RELAY_SECRET = generateSecretKey();
export const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
export const AGENT = "a".repeat(64);
export const OWNER = "b".repeat(64);
/** Friday 30 October 2026, 14:00 UTC: the end of the fixture week. */
export const AS_OF = 1_793_368_800;
export const WEEK = 7 * 86_400;

function reading(metric, value, previous = null) {
  return {
    metric,
    value,
    previous,
    change: value !== null && previous !== null ? value - previous : null,
  };
}

/**
 * The same week as the Rust test `a_week_of_fixture_records_gives_exact_numbers`
 * in `company_numbers.rs`: these figures are what the relay counts for it.
 */
export function functionCards() {
  return [
    {
      function: "sales",
      metrics: [
        reading("leads_found", 3, 2),
        reading("contacted", 3, 1),
        reading("replied", 1, 2),
        reading("quotes", 1, 0),
        reading("won", 2, 0),
      ],
      notTracked: ["calls"],
    },
    {
      function: "operations",
      metrics: [
        reading("workers_started", 3, 1),
        reading("workers_done", 1, 1),
        reading("workers_failed", 1, 0),
        reading("plans_approved", 1, 1),
      ],
      notTracked: ["jobs_in_progress", "days_to_deliver", "revisions"],
    },
    {
      function: "customer_success",
      metrics: [reading("active_clients", 4)],
      notTracked: ["renewals", "referrals"],
    },
    {
      function: "finance",
      metrics: [
        reading("cash_in", 175_050, 80_000),
        reading("invoiced", 300_000, 120_000),
        reading("owed", 144_950),
        reading("worker_cost", 45, 100),
      ],
      notTracked: ["recurring"],
    },
    {
      function: "brand",
      metrics: [reading("cost_per_win", 23)],
      notTracked: [],
    },
  ];
}

export function scorecardContent(overrides = {}) {
  return {
    schemaVersion: 1,
    asOf: AS_OF,
    windowStart: AS_OF - WEEK,
    previousStart: AS_OF - 2 * WEEK,
    currency: "ZAR",
    otherCurrencyFacts: 0,
    functions: functionCards(),
    goals: [
      {
        goalId: GOAL_ID,
        function: "sales",
        title: "5 new clients a month",
        metric: "won",
        target: 5,
        period: "month",
        current: 3,
        percent: 60,
      },
    ],
    ...overrides,
  };
}

export function goalContent(overrides = {}) {
  return {
    schemaVersion: 1,
    goalId: GOAL_ID,
    function: "sales",
    title: "5 new clients a month",
    metric: "won",
    target: 5,
    period: "month",
    status: "proposed",
    reason: "Last month closed 3.",
    proposedByPubkey: AGENT,
    proposedAt: AS_OF - 3_600,
    sourceActionEventId: "c".repeat(64),
    ...overrides,
  };
}

export function reviewContent(overrides = {}) {
  return {
    schemaVersion: 1,
    reviewDate: REVIEW_DATE,
    asOf: AS_OF,
    windowStart: AS_OF - WEEK,
    previousStart: AS_OF - 2 * WEEK,
    currency: "ZAR",
    otherCurrencyFacts: 0,
    functions: functionCards(),
    wins: ["Two proposals accepted"],
    misses: ["Replies fell from 2 to 1"],
    decisions: [
      {
        decisionId: "hire-cs",
        title: "Hire a Customer Success lead?",
        detail: "Four active clients now.",
        function: "customer_success",
        state: "open",
      },
    ],
    annotatedByPubkey: AGENT,
    annotatedAt: AS_OF + 3_600,
    createdAt: AS_OF + 600,
    sourceActionEventId: "d".repeat(64),
    ...overrides,
  };
}

function sign(kind, content, dTag, overrides = {}) {
  return finalizeEvent(
    {
      kind,
      content: JSON.stringify(content),
      tags: [["d", dTag]],
      created_at: AS_OF + 7_200,
      ...overrides,
    },
    overrides.secret ?? RELAY_SECRET,
  );
}

export function signScorecard(content = scorecardContent(), overrides = {}) {
  return sign(KIND_NUMBERS_HEAD, content, SCORECARD_D_TAG, overrides);
}

export function signGoal(content = goalContent(), overrides = {}) {
  return sign(
    KIND_NUMBERS_HEAD,
    content,
    goalDTag(content.goalId ?? GOAL_ID),
    overrides,
  );
}

export function signReview(content = reviewContent(), overrides = {}) {
  return sign(
    KIND_NUMBERS_HEAD,
    content,
    reviewDTag(content.reviewDate ?? REVIEW_DATE),
    overrides,
  );
}
