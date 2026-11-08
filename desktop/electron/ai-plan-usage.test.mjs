import assert from "node:assert/strict";
import test from "node:test";

import fixtures from "./fixtures/ai-plan-usage.json" with { type: "json" };
import {
  AI_PLAN_USAGE_UNAVAILABLE_MESSAGE,
  normalizeAiPlanUsage,
  readAiPlanUsage,
} from "./ai-plan-usage.mjs";

const NOW = 1_800_000_000_000;

test("current provider readers return explicit unavailable snapshots without a credential probe", () => {
  assert.deepEqual(readAiPlanUsage({ now: () => NOW }), [
    {
      provider: "codex",
      availability: "unavailable",
      usedPercent: null,
      resetAt: null,
      source: "unavailable",
      observedAt: NOW,
      freshness: "unavailable",
      confidence: null,
      message: AI_PLAN_USAGE_UNAVAILABLE_MESSAGE,
    },
    {
      provider: "claude",
      availability: "unavailable",
      usedPercent: null,
      resetAt: null,
      source: "unavailable",
      observedAt: NOW,
      freshness: "unavailable",
      confidence: null,
      message: AI_PLAN_USAGE_UNAVAILABLE_MESSAGE,
    },
  ]);
});

test("normalizes recorded reported and estimated fixtures without retaining source credentials", () => {
  assert.deepEqual(
    normalizeAiPlanUsage("codex", fixtures.reportedCodex, { now: NOW }),
    {
      provider: "codex",
      availability: "available",
      usedPercent: 62,
      resetAt: 1_800_003_600_000,
      source: "codex-app-server",
      observedAt: NOW,
      freshness: "fresh",
      confidence: "reported",
      message: null,
    },
  );
  assert.deepEqual(
    normalizeAiPlanUsage("claude", fixtures.estimatedClaude, { now: NOW }),
    {
      provider: "claude",
      availability: "available",
      usedPercent: 31.5,
      resetAt: 1_800_007_200_000,
      source: "colony-token-counts",
      observedAt: 1_799_999_400_000,
      freshness: "stale",
      confidence: "estimated",
      message: null,
    },
  );
});

test("invalid provider data cannot fabricate a usable percentage", () => {
  const invalidCandidates = [
    {
      provider: "codex",
      candidate: { ...fixtures.reportedCodex, usedPercent: 101 },
    },
    {
      provider: "claude",
      candidate: { ...fixtures.estimatedClaude, confidence: "reported" },
    },
    {
      provider: "codex",
      candidate: { ...fixtures.reportedCodex, resetAt: NOW },
    },
    {
      provider: "codex",
      candidate: { ...fixtures.reportedCodex, observedAt: NOW + 1 },
    },
    {
      provider: "codex",
      candidate: { ...fixtures.reportedCodex, source: "unsupported-source" },
    },
  ];
  for (const { provider, candidate } of invalidCandidates) {
    const result = normalizeAiPlanUsage(provider, candidate, { now: NOW });
    assert.equal(result.availability, "unavailable");
    assert.equal(result.usedPercent, null);
    assert.equal(result.message, AI_PLAN_USAGE_UNAVAILABLE_MESSAGE);
  }
});
