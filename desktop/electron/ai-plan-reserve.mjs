import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { readAiPlanUsage } from "./ai-plan-usage.mjs";

const STATE_VERSION = 1;
const MAX_OVERRIDES = 64;

/** Default desktop-local preference. The reserve is off until its owner enables it. */
export const DEFAULT_AI_PLAN_RESERVE = Object.freeze({
  enabled: false,
  reservedPercent: 25,
});

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNow(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("AI plan reserve requires a valid current time.");
  }
  return value;
}

/** Validate a reserve preference before it can be persisted or evaluated. */
export function normalizeAiPlanReservePreference(value) {
  if (!isObject(value))
    throw new TypeError("Invalid AI plan reserve preference.");
  if (typeof value.enabled !== "boolean") {
    throw new TypeError("AI plan reserve enabled must be a boolean.");
  }
  if (
    !Number.isInteger(value.reservedPercent) ||
    value.reservedPercent < 0 ||
    value.reservedPercent > 100
  ) {
    throw new TypeError("AI plan reserve must be between 0 and 100 percent.");
  }
  return {
    enabled: value.enabled,
    reservedPercent: value.reservedPercent,
  };
}

function defaultState() {
  return {
    version: STATE_VERSION,
    revision: 0,
    preference: { ...DEFAULT_AI_PLAN_RESERVE },
    overrides: {},
  };
}

function parseState(value) {
  if (!isObject(value) || value.version !== STATE_VERSION) {
    throw new Error("AI plan reserve storage is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error("AI plan reserve storage is invalid.");
  }
  if (!isObject(value.overrides)) {
    throw new Error("AI plan reserve storage is invalid.");
  }
  const entries = Object.entries(value.overrides);
  if (entries.length > MAX_OVERRIDES) {
    throw new Error("AI plan reserve storage is invalid.");
  }
  for (const [windowKey, usedAt] of entries) {
    if (
      windowKey.length === 0 ||
      windowKey.length > 160 ||
      !Number.isSafeInteger(usedAt) ||
      usedAt < 0
    ) {
      throw new Error("AI plan reserve storage is invalid.");
    }
  }
  return {
    version: STATE_VERSION,
    revision: value.revision,
    preference: normalizeAiPlanReservePreference(value.preference),
    overrides: { ...value.overrides },
  };
}

/** Build an atomic JSON snapshot store for non-secret AI plan preferences. */
export function createAiPlanReserveSnapshotStore(
  userData,
  { platform = process.platform } = {},
) {
  if (!path.isAbsolute(userData)) {
    throw new TypeError(
      "AI plan reserve storage needs an absolute user-data path.",
    );
  }
  const file = path.join(userData, "ai-plan-reserve.json");

  async function read() {
    try {
      return parseState(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return defaultState();
      }
      throw error;
    }
  }

  async function write(value) {
    const state = parseState(value);
    const root = path.dirname(file);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    let failure;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
      if (platform !== "win32") {
        const directory = await open(root, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        await unlink(temporary);
      } catch (error) {
        if (!(error && typeof error === "object" && error.code === "ENOENT")) {
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
  }

  return { file, read, write };
}

function isActionableUsage(entry, now) {
  return (
    isObject(entry) &&
    entry.availability === "available" &&
    entry.freshness === "fresh" &&
    typeof entry.provider === "string" &&
    Number.isFinite(entry.usedPercent) &&
    entry.usedPercent >= 0 &&
    entry.usedPercent <= 100 &&
    Number.isSafeInteger(entry.resetAt) &&
    entry.resetAt > now
  );
}

/** Make a persisted one-window override key from a normalized usage snapshot. */
export function aiPlanReserveWindowKey(usage) {
  return `${usage.provider}:${usage.resetAt}`;
}

function compactOverrides(overrides, now) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([windowKey]) => {
      const separator = windowKey.lastIndexOf(":");
      const resetAt = Number(windowKey.slice(separator + 1));
      return separator > 0 && Number.isSafeInteger(resetAt) && resetAt > now;
    }),
  );
}

/**
 * Decide whether Scout may begin a new outreach draft. Existing drafts and all
 * sending remain outside this policy. Unknown, stale, and reset usage never
 * block work because they cannot honestly prove a current reserve crossing.
 */
export function evaluateAiPlanReserve({
  preference = DEFAULT_AI_PLAN_RESERVE,
  usage = [],
  overrides = new Set(),
  now = Date.now(),
} = {}) {
  const currentTime = assertNow(now);
  const normalizedPreference = normalizeAiPlanReservePreference(preference);
  if (!normalizedPreference.enabled) {
    return { state: "allowed", reasonCode: "reserve_off", reason: null };
  }
  if (normalizedPreference.reservedPercent === 0) {
    return { state: "allowed", reasonCode: "no_reserve", reason: null };
  }
  const actionable = usage.filter((entry) =>
    isActionableUsage(entry, currentTime),
  );
  if (actionable.length === 0) {
    return {
      state: "allowed",
      reasonCode: "usage_unavailable",
      reason: null,
    };
  }
  const threshold = 100 - normalizedPreference.reservedPercent;
  let usedOverride = false;
  for (const entry of actionable) {
    if (entry.usedPercent < threshold) continue;
    const overrideKey = aiPlanReserveWindowKey(entry);
    if (overrides.has(overrideKey)) {
      usedOverride = true;
      continue;
    }
    return {
      state: "paused",
      reasonCode: "reserve_crossed",
      reason: `Scout outreach drafting is paused to keep ${normalizedPreference.reservedPercent}% of your AI plan free.`,
      provider: entry.provider,
      resetAt: entry.resetAt,
      overrideKey,
    };
  }
  return {
    state: "allowed",
    reasonCode: usedOverride ? "one_off_override" : "within_reserve",
    reason: null,
  };
}

function resultFor(snapshot, usage, generation, now) {
  const overrides = new Set(Object.keys(snapshot.overrides));
  return {
    preference: { ...snapshot.preference },
    usage: usage.map((entry) => ({ ...entry })),
    admission: evaluateAiPlanReserve({
      preference: snapshot.preference,
      usage,
      overrides,
      now,
    }),
    revision: snapshot.revision,
    generation,
  };
}

/**
 * Create the desktop-local plan reserve service. Failed reads and writes reject
 * to the renderer. Writes serialize and carry a generation so stale async UI
 * responses cannot become the latest persisted preference.
 */
export function createAiPlanReserveService({
  userData,
  readUsage = readAiPlanUsage,
  now = Date.now,
  snapshotStore = createAiPlanReserveSnapshotStore(userData),
} = {}) {
  if (!snapshotStore || typeof snapshotStore.read !== "function") {
    throw new TypeError("AI plan reserve needs a snapshot reader.");
  }
  if (typeof snapshotStore.write !== "function") {
    throw new TypeError("AI plan reserve needs a snapshot writer.");
  }
  let queue = Promise.resolve();
  let generation = 0;

  function enqueue(operation) {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  }

  async function loadUsage(currentTime) {
    const usage = await readUsage({ now: () => currentTime });
    if (!Array.isArray(usage)) {
      throw new Error("AI plan usage reader returned an invalid result.");
    }
    return usage;
  }

  function get() {
    const requestGeneration = generation;
    return enqueue(async () => {
      const currentTime = assertNow(now());
      const snapshot = await snapshotStore.read();
      const usage = await loadUsage(currentTime);
      return resultFor(snapshot, usage, requestGeneration, currentTime);
    });
  }

  function update(preference) {
    const nextPreference = normalizeAiPlanReservePreference(preference);
    const requestGeneration = ++generation;
    return enqueue(async () => {
      const currentTime = assertNow(now());
      const usage = await loadUsage(currentTime);
      const snapshot = await snapshotStore.read();
      const next = {
        ...snapshot,
        revision: snapshot.revision + 1,
        preference: nextPreference,
        overrides: compactOverrides(snapshot.overrides, currentTime),
      };
      await snapshotStore.write(next);
      return resultFor(next, usage, requestGeneration, currentTime);
    });
  }

  function overrideOnce() {
    const requestGeneration = ++generation;
    return enqueue(async () => {
      const currentTime = assertNow(now());
      const usage = await loadUsage(currentTime);
      const snapshot = await snapshotStore.read();
      const overrides = compactOverrides(snapshot.overrides, currentTime);
      const admission = evaluateAiPlanReserve({
        preference: snapshot.preference,
        usage,
        overrides: new Set(Object.keys(overrides)),
        now: currentTime,
      });
      if (admission.state !== "paused" || !admission.overrideKey) {
        return resultFor(snapshot, usage, requestGeneration, currentTime);
      }
      const next = {
        ...snapshot,
        revision: snapshot.revision + 1,
        overrides: {
          ...overrides,
          [admission.overrideKey]: currentTime,
        },
      };
      await snapshotStore.write(next);
      return resultFor(next, usage, requestGeneration, currentTime);
    });
  }

  return { get, update, overrideOnce };
}
