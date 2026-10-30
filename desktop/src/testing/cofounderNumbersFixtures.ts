import type { MockNumbers } from "./e2eBridge";

const AS_OF = 1_793_368_800;
const WEEK = 7 * 86_400;
const GOAL_ID = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";
const PROPOSED_GOAL_ID = "9a0e411d-92ed-4fc0-a6e0-0e75312d8221";

function functionCards() {
  return [
    {
      function: "sales",
      metrics: [
        { metric: "leads_found", value: 3, previous: 2, change: 1 },
        { metric: "contacted", value: 3, previous: 1, change: 2 },
        { metric: "replied", value: 1, previous: 2, change: -1 },
        { metric: "quotes", value: 1, previous: 0, change: 1 },
        { metric: "won", value: 2, previous: 0, change: 2 },
      ],
      notTracked: ["calls"],
    },
    {
      function: "operations",
      metrics: [
        { metric: "workers_started", value: 3, previous: 1, change: 2 },
        { metric: "workers_done", value: 1, previous: 1, change: 0 },
        { metric: "workers_failed", value: 1, previous: 0, change: 1 },
        { metric: "plans_approved", value: 1, previous: 1, change: 0 },
      ],
      notTracked: ["jobs_in_progress", "days_to_deliver", "revisions"],
    },
    {
      function: "customer_success",
      metrics: [
        { metric: "active_clients", value: 4, previous: null, change: null },
      ],
      notTracked: ["renewals", "referrals"],
    },
    {
      function: "finance",
      metrics: [
        { metric: "cash_in", value: 175_050, previous: 80_000, change: 95_050 },
        {
          metric: "invoiced",
          value: 300_000,
          previous: 120_000,
          change: 180_000,
        },
        { metric: "owed", value: 144_950, previous: null, change: null },
        { metric: "worker_cost", value: 45, previous: 100, change: -55 },
      ],
      notTracked: ["recurring"],
    },
    {
      function: "brand",
      metrics: [
        { metric: "cost_per_win", value: 23, previous: null, change: null },
      ],
      notTracked: [],
    },
  ];
}

/** Creates relay-shaped company numbers records for mock bridge UI tests. */
export function makeCofounderNumbersFixture({
  ownerPubkey,
  scoutPubkey,
  salesLeadPubkey,
  includeProposal = false,
}: {
  ownerPubkey: string;
  scoutPubkey: string;
  salesLeadPubkey: string;
  includeProposal?: boolean;
}): MockNumbers {
  const functions = functionCards();
  return {
    scorecard: {
      schemaVersion: 1,
      asOf: AS_OF,
      windowStart: AS_OF - WEEK,
      previousStart: AS_OF - 2 * WEEK,
      currency: "ZAR",
      otherCurrencyFacts: 0,
      functions,
      goals: [
        {
          goalId: GOAL_ID,
          function: "sales",
          title: "5 new clients in November",
          metric: "won",
          target: 5,
          period: "month",
          current: 3,
          percent: 60,
        },
      ],
    },
    goals: [
      {
        schemaVersion: 1,
        goalId: GOAL_ID,
        function: "sales",
        title: "5 new clients in November",
        metric: "won",
        target: 5,
        period: "month",
        status: "approved",
        reason: "Last month closed 3.",
        proposedByPubkey: salesLeadPubkey,
        proposedAt: AS_OF - 3_600,
        decidedByPubkey: ownerPubkey,
        decidedAt: AS_OF + 1_200,
        note: null,
        sourceActionEventId: "c".repeat(64),
      },
      ...(includeProposal
        ? [
            {
              schemaVersion: 1,
              goalId: PROPOSED_GOAL_ID,
              function: "sales",
              title: "Follow up with five new leads this week",
              metric: "leads_found",
              target: 5,
              period: "week",
              status: "proposed",
              reason: "The pipeline needs more first conversations.",
              proposedByPubkey: scoutPubkey,
              proposedAt: AS_OF - 3_600,
              decidedByPubkey: null,
              decidedAt: null,
              note: null,
              sourceActionEventId: "e".repeat(64),
            },
          ]
        : []),
    ],
    reviews: [
      {
        schemaVersion: 1,
        reviewDate: "2026-10-30",
        asOf: AS_OF,
        windowStart: AS_OF - WEEK,
        previousStart: AS_OF - 2 * WEEK,
        currency: "ZAR",
        otherCurrencyFacts: 0,
        functions,
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
        annotatedByPubkey: scoutPubkey,
        annotatedAt: AS_OF + 3_600,
        createdAt: AS_OF + 600,
        sourceActionEventId: "d".repeat(64),
      },
    ],
  };
}

export const PROPOSED_COFOUNDER_GOAL_ID = PROPOSED_GOAL_ID;
