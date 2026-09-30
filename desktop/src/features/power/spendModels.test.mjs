import assert from "node:assert/strict";
import test from "node:test";

import {
  formatUsdCentsFixed,
  nanoUsdToCents,
  summarizeAllowanceUsage,
  weeklyAllowanceEquivalentCents,
} from "./spendModels.ts";

const employee = "a".repeat(64);

function agentTurn({ id, reportedAt, amount, status = "active", model }) {
  return {
    dTag: `company:ai-spend:usage:${id}`,
    event: {},
    head: {
      status,
      record: {
        recordType: "agent_turn",
        employeePubkey: employee,
        sourceUsageEventId: id,
        ...(amount === undefined ? {} : { estimatedAmountNanoUsd: amount }),
        isEstimate: true,
        sourceOfFunds: "unknown",
        reportedAt,
        ...(model ? { model } : {}),
      },
    },
  };
}

test("allowance usage uses injected period boundaries and integer minor units", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const summary = summarizeAllowanceUsage(
    [
      agentTurn({
        id: "1".repeat(64),
        reportedAt: "2026-09-28T10:00:00.000Z",
        amount: "15000000",
        model: "model-a",
      }),
      agentTurn({
        id: "2".repeat(64),
        reportedAt: "2026-09-29T10:00:00.000Z",
        amount: "25000000",
        model: "model-a",
      }),
      agentTurn({
        id: "3".repeat(64),
        reportedAt: "2026-09-21T10:00:00.000Z",
        amount: "90000000",
      }),
      agentTurn({
        id: "4".repeat(64),
        reportedAt: "2026-09-30T10:00:00.000Z",
        status: "removed",
        amount: "90000000",
      }),
    ],
    employee,
    "week",
    now,
  );

  assert.equal(summary.turnCount, 2);
  assert.equal(summary.pricedTurnCount, 2);
  assert.equal(summary.unpricedTurnCount, 0);
  assert.equal(summary.totalNanoUsd, 40_000_000n);
  assert.equal(nanoUsdToCents(summary.totalNanoUsd), 4n);
  assert.equal(summary.byModel.get("model-a"), 40_000_000n);
});

test("missing harness cost stays unpriced and is not converted to zero usage", () => {
  const summary = summarizeAllowanceUsage(
    [
      agentTurn({
        id: "5".repeat(64),
        reportedAt: "2026-09-30T10:00:00.000Z",
      }),
    ],
    employee,
    "day",
    new Date("2026-09-30T12:00:00.000Z"),
  );

  assert.equal(summary.turnCount, 1);
  assert.equal(summary.pricedTurnCount, 0);
  assert.equal(summary.unpricedTurnCount, 1);
  assert.equal(summary.totalNanoUsd, 0n);
  assert.equal(summary.byModel.size, 0);
});

test("weekly allowance equivalents stay in cents without floating point", () => {
  assert.equal(weeklyAllowanceEquivalentCents("199", "day"), 1_393n);
  assert.equal(weeklyAllowanceEquivalentCents("1000", "week"), 1_000n);
  assert.equal(weeklyAllowanceEquivalentCents("1050", "month"), 242n);
});

test("USD fixed format keeps two fractional digits for cash views", () => {
  assert.equal(formatUsdCentsFixed("0"), "USD 0.00");
  assert.equal(formatUsdCentsFixed("20000"), "USD 200.00");
  assert.equal(formatUsdCentsFixed("123456"), "USD 1,234.56");
});
