import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAiPlanReserveSnapshotStore,
  createAiPlanReserveService,
  DEFAULT_AI_PLAN_RESERVE,
  evaluateAiPlanReserve,
} from "./ai-plan-reserve.mjs";

const NOW = 1_800_000_000_000;
const TEST_TEMP_PREFIX = join(tmpdir(), "colony-ai-plan-reserve-test-");
const TEST_USER_DATA = join(tmpdir(), "colony-ai-plan-reserve-test");

function reportedUsage({ usedPercent, resetAt = NOW + 3_600_000 } = {}) {
  return {
    provider: "codex",
    availability: "available",
    usedPercent,
    resetAt,
    source: "codex-app-server",
    observedAt: NOW,
    freshness: "fresh",
    confidence: "reported",
    message: null,
  };
}

function memoryStore(initial) {
  let state = initial ?? {
    version: 1,
    revision: 0,
    preference: { ...DEFAULT_AI_PLAN_RESERVE },
    overrides: {},
  };
  return {
    async read() {
      return JSON.parse(JSON.stringify(state));
    },
    async write(next) {
      state = JSON.parse(JSON.stringify(next));
    },
  };
}

test("snapshot store atomically persists only the non-secret reserve preference", async () => {
  const userData = await mkdtemp(TEST_TEMP_PREFIX);
  assert.ok(userData.startsWith(TEST_TEMP_PREFIX));
  try {
    const store = createAiPlanReserveSnapshotStore(userData);
    const initial = await store.read();
    assert.deepEqual(initial.preference, DEFAULT_AI_PLAN_RESERVE);

    const next = {
      ...initial,
      revision: 1,
      preference: { enabled: true, reservedPercent: 30 },
      overrides: { "codex:1800003600000": NOW },
    };
    await store.write(next);

    assert.deepEqual(await store.read(), next);
    assert.deepEqual(await readdir(userData), ["ai-plan-reserve.json"]);
  } finally {
    await rm(userData, { force: true, recursive: true });
  }
});

test("reserve allows zero use and a zero reserve", () => {
  const preference = { enabled: true, reservedPercent: 25 };
  assert.equal(
    evaluateAiPlanReserve({
      preference,
      usage: [reportedUsage({ usedPercent: 0 })],
      now: NOW,
    }).state,
    "allowed",
  );
  assert.equal(
    evaluateAiPlanReserve({
      preference: { enabled: true, reservedPercent: 0 },
      usage: [reportedUsage({ usedPercent: 100 })],
      now: NOW,
    }).state,
    "allowed",
  );
});

test("reserve pauses exactly at its threshold and above it", () => {
  const preference = { enabled: true, reservedPercent: 25 };
  const exact = evaluateAiPlanReserve({
    preference,
    usage: [reportedUsage({ usedPercent: 75 })],
    now: NOW,
  });
  assert.equal(exact.state, "paused");
  assert.equal(exact.reasonCode, "reserve_crossed");
  assert.equal(
    exact.reason,
    "Scout outreach drafting is paused to keep 25% of your AI plan free.",
  );
  assert.equal(
    evaluateAiPlanReserve({
      preference,
      usage: [reportedUsage({ usedPercent: 76 })],
      now: NOW,
    }).state,
    "paused",
  );
});

test("a reset window resumes drafting and unavailable usage never pauses it", () => {
  const preference = { enabled: true, reservedPercent: 25 };
  assert.equal(
    evaluateAiPlanReserve({
      preference,
      usage: [reportedUsage({ usedPercent: 99, resetAt: NOW })],
      now: NOW,
    }).reasonCode,
    "usage_unavailable",
  );
  assert.equal(
    evaluateAiPlanReserve({
      preference,
      usage: [
        {
          provider: "claude",
          availability: "unavailable",
          usedPercent: null,
          resetAt: null,
          source: "unavailable",
          observedAt: NOW,
          freshness: "unavailable",
          confidence: null,
          message: "usage not available for your AI",
        },
      ],
      now: NOW,
    }).reasonCode,
    "usage_unavailable",
  );
});

test("stale, unavailable, and malformed usage never creates a pause", () => {
  const preference = { enabled: true, reservedPercent: 25 };
  const untrustedUsage = [
    {
      ...reportedUsage({ usedPercent: 99 }),
      freshness: "stale",
    },
    {
      ...reportedUsage({ usedPercent: 99 }),
      availability: "unavailable",
    },
    reportedUsage({ usedPercent: 101 }),
  ];
  for (const usage of untrustedUsage) {
    assert.equal(
      evaluateAiPlanReserve({ preference, usage: [usage], now: NOW })
        .reasonCode,
      "usage_unavailable",
    );
  }
});

test("a disabled reserve cannot pause Scout outreach drafting", () => {
  assert.equal(
    evaluateAiPlanReserve({
      preference: { enabled: false, reservedPercent: 25 },
      usage: [reportedUsage({ usedPercent: 100 })],
      now: NOW,
    }).reasonCode,
    "reserve_off",
  );
});

test("one override is durable for one usage window and does not carry into the next", async () => {
  let usage = [reportedUsage({ usedPercent: 80 })];
  const store = memoryStore();
  const service = createAiPlanReserveService({
    userData: TEST_USER_DATA,
    now: () => NOW,
    readUsage: async () => usage,
    snapshotStore: store,
  });
  await service.update({ enabled: true, reservedPercent: 25 });
  assert.equal((await service.get()).admission.state, "paused");
  assert.equal(
    (await service.overrideOnce()).admission.reasonCode,
    "one_off_override",
  );
  assert.equal((await service.get()).admission.reasonCode, "one_off_override");
  usage = [reportedUsage({ usedPercent: 80, resetAt: NOW + 7_200_000 })];
  assert.equal((await service.get()).admission.state, "paused");
});

test("serialized writes retain the latest generation and write failures propagate", async () => {
  const store = memoryStore();
  const service = createAiPlanReserveService({
    userData: TEST_USER_DATA,
    now: () => NOW,
    readUsage: async () => [reportedUsage({ usedPercent: 20 })],
    snapshotStore: store,
  });
  const first = service.update({ enabled: true, reservedPercent: 20 });
  const second = service.update({ enabled: true, reservedPercent: 30 });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.ok(firstResult.generation < secondResult.generation);
  assert.equal((await service.get()).preference.reservedPercent, 30);

  const failingService = createAiPlanReserveService({
    userData: TEST_USER_DATA,
    now: () => NOW,
    readUsage: async () => [reportedUsage({ usedPercent: 20 })],
    snapshotStore: {
      read: async () => ({
        version: 1,
        revision: 0,
        preference: { ...DEFAULT_AI_PLAN_RESERVE },
        overrides: {},
      }),
      write: async () => {
        throw new Error("storage unavailable");
      },
    },
  });
  await assert.rejects(
    failingService.update({ enabled: true, reservedPercent: 25 }),
    /storage unavailable/u,
  );

  const unreadableService = createAiPlanReserveService({
    userData: TEST_USER_DATA,
    now: () => NOW,
    readUsage: async () => [reportedUsage({ usedPercent: 20 })],
    snapshotStore: {
      read: async () => {
        throw new Error("storage unavailable");
      },
      write: async () => undefined,
    },
  });
  await assert.rejects(unreadableService.get(), /storage unavailable/u);
});
