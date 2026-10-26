import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadManagedAgentsForSend,
  MANAGED_AGENTS_RETRY_DELAYS_MS,
} from "./managedAgentsForSend.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const NOVA = "dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321";

const agent = (pubkey, status = "stopped", backend = "local") => ({
  pubkey,
  name: pubkey === SCOUT ? "Scout" : "Nova",
  status,
  backend: { type: backend },
});

/** A virtual clock: sleeping advances it, so a test never waits for real. */
function clock() {
  let now = 0;
  const sleeps = [];
  return {
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe("loadManagedAgentsForSend", () => {
  it("is bounded when the host never answers a read", async () => {
    const started = Date.now();
    const result = await loadManagedAgentsForSend({
      cached: undefined,
      refetch: () => new Promise(() => {}),
      mentionedPubkeys: [SCOUT],
      readTimeoutMs: 10,
      budgetMs: 60,
      retryDelaysMs: [5, 5, 5, 5, 5, 5, 5, 5],
      warn: () => {},
    });
    assert.deepEqual(result, { agents: [], verified: false });
    assert.ok(Date.now() - started < 2_000, "gave up on its own");
  });

  it("uses the cached list when no mentioned agent looks running", async () => {
    const cached = [agent(SCOUT, "stopped"), agent(NOVA, "running")];
    let reads = 0;
    const result = await loadManagedAgentsForSend({
      cached,
      refetch: async () => {
        reads += 1;
        return [];
      },
      mentionedPubkeys: [SCOUT],
      ...clock(),
    });
    assert.equal(reads, 0);
    assert.deepEqual(result, { agents: cached, verified: true });
  });

  it("reads the host when the cache says a mentioned agent is running", async () => {
    // The harness died; the cache has not caught up. The host looks at the
    // process and says stopped, which is what the wake decision must see.
    const cached = [agent(SCOUT, "running")];
    const fresh = [agent(SCOUT, "stopped")];
    const result = await loadManagedAgentsForSend({
      cached,
      refetch: async () => fresh,
      mentionedPubkeys: [SCOUT],
      ...clock(),
    });
    assert.deepEqual(result, { agents: fresh, verified: true });
  });

  it("does not read the host for a provider-backed agent shown as deployed", async () => {
    const cached = [agent(SCOUT, "deployed", "provider")];
    let reads = 0;
    await loadManagedAgentsForSend({
      cached,
      refetch: async () => {
        reads += 1;
        return cached;
      },
      mentionedPubkeys: [SCOUT],
      ...clock(),
    });
    assert.equal(reads, 0);
  });

  it("reads again until the host answers when nothing is loaded yet", async () => {
    // Launch: the first reads fail while the host is still coming up.
    const time = clock();
    let reads = 0;
    const fresh = [agent(SCOUT, "stopped")];
    const result = await loadManagedAgentsForSend({
      cached: undefined,
      refetch: async () => {
        reads += 1;
        if (reads < 3) throw new Error("host not ready");
        return fresh;
      },
      mentionedPubkeys: [SCOUT],
      ...time,
    });
    assert.equal(reads, 3);
    assert.deepEqual(time.sleeps, [250, 500]);
    assert.deepEqual(result, { agents: fresh, verified: true });
  });

  it("never turns a failed read into a verified empty list", async () => {
    const time = clock();
    const warnings = [];
    const result = await loadManagedAgentsForSend({
      cached: undefined,
      refetch: async () => {
        throw new Error("host not ready");
      },
      mentionedPubkeys: [SCOUT],
      warn: (message) => warnings.push(message),
      ...time,
    });
    assert.deepEqual(result, { agents: [], verified: false });
    assert.equal(warnings.length, 1);
    // Bounded: never longer than the budget.
    assert.ok(time.sleeps.reduce((a, b) => a + b, 0) <= 4_000);
    assert.ok(time.sleeps.length <= MANAGED_AGENTS_RETRY_DELAYS_MS.length);
  });

  it("falls back to the cached list, flagged unverified, when the host stays silent", async () => {
    const cached = [agent(SCOUT, "running")];
    const result = await loadManagedAgentsForSend({
      cached,
      refetch: async () => {
        throw new Error("host not ready");
      },
      mentionedPubkeys: [SCOUT],
      warn: () => {},
      ...clock(),
    });
    assert.deepEqual(result, { agents: cached, verified: false });
  });
});
