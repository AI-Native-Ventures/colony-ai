import assert from "node:assert/strict";
import test from "node:test";

import { createQualifyRunController } from "./run-controller.mjs";

const NOW = 1_762_000_000_000;
const RUN_ID = "d39cf188-319a-4efc-92cc-8c55c5f2d6d2";

function memoryStore() {
  const runs = new Map();
  return {
    async read(id) {
      return runs.has(id) ? structuredClone(runs.get(id)) : null;
    },
    async write(run) {
      runs.set(run.runId, structuredClone(run));
    },
  };
}

function lead(index) {
  return {
    leadId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    website: `https://lead-${index}.example/`,
  };
}

function successFetcher(onFetch = () => {}) {
  return async (url, { signal }) => {
    await onFetch(url, signal);
    if (url.endsWith("/robots.txt")) {
      return { url, text: "User-agent: *\nAllow: /", finalProtocol: "https:" };
    }
    return {
      url,
      text: "<meta name=viewport content=width=device-width>",
      finalProtocol: "https:",
      downgradedFromHttps: false,
    };
  };
}

function controller(overrides = {}) {
  return createQualifyRunController({
    store: memoryStore(),
    loadHead: async () => null,
    publish: async () => {},
    fetchPage: successFetcher(),
    clock: () => NOW,
    makeRunId: () => RUN_ID,
    ...overrides,
  });
}

test("controller caps a run at 300 leads and never exceeds four active businesses", async () => {
  let active = 0;
  let highWater = 0;
  let homepageCalls = 0;
  const result = await controller({
    fetchPage: successFetcher(async (url) => {
      if (!url.endsWith("/robots.txt")) {
        homepageCalls += 1;
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      }
    }),
  }).start({
    selectedSignals: ["HAS_WHATSAPP_LINK"],
    leads: Array.from({ length: 305 }, (_, index) => lead(index)),
  });
  assert.equal(result.items.length, 300);
  assert.equal(homepageCalls, 300);
  assert.ok(highWater <= 4, `active businesses ${highWater}`);
});

test("controller skips a fresh head unless refresh is explicitly requested", async () => {
  let fetched = 0;
  const freshHead = {
    eventId: "a".repeat(64),
    record: { checkedAt: NOW / 1_000 - 60 },
  };
  const run = await controller({
    loadHead: async () => freshHead,
    fetchPage: successFetcher(() => {
      fetched += 1;
    }),
  }).start({ selectedSignals: ["HAS_WHATSAPP_LINK"], leads: [lead(1)] });
  assert.equal(run.items[0].phase, "skipped_fresh");
  assert.equal(fetched, 0);

  const refreshed = await controller({
    loadHead: async () => freshHead,
    fetchPage: successFetcher(() => {
      fetched += 1;
    }),
  }).start({
    selectedSignals: ["HAS_WHATSAPP_LINK"],
    leads: [lead(2)],
    refresh: true,
  });
  assert.equal(refreshed.items[0].phase, "completed");
  assert.ok(fetched >= 2);
});

test("controller preserves an unpublished action and resumes it without refetching", async () => {
  const store = memoryStore();
  let publishes = 0;
  let fetches = 0;
  const instance = createQualifyRunController({
    store,
    loadHead: async () => null,
    publish: async () => {
      publishes += 1;
      if (publishes === 1) throw new Error("publish interrupted");
    },
    fetchPage: successFetcher(() => {
      fetches += 1;
    }),
    clock: () => NOW,
    makeRunId: () => RUN_ID,
  });
  const paused = await instance.start({
    selectedSignals: ["HAS_WHATSAPP_LINK"],
    leads: [lead(1)],
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.items[0].phase, "ready_to_publish");
  const resumed = await instance.resume(RUN_ID);
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.items[0].phase, "completed");
  assert.equal(fetches, 2, "robots and homepage fetched only before resume");
});

test("cancel stops scheduling new leads and leaves their work resumable", async () => {
  const store = memoryStore();
  let began = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const instance = createQualifyRunController({
    store,
    loadHead: async () => null,
    publish: async () => {},
    fetchPage: async (url, { signal }) => {
      if (url.endsWith("/robots.txt"))
        return { url, text: "User-agent: *", finalProtocol: "https:" };
      began += 1;
      await Promise.race([
        gate,
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
      ]);
      return { url, text: "<meta name=viewport>", finalProtocol: "https:" };
    },
    clock: () => NOW,
    makeRunId: () => RUN_ID,
  });
  const started = instance.start({
    selectedSignals: ["HAS_WHATSAPP_LINK"],
    leads: Array.from({ length: 10 }, (_, index) => lead(index)),
  });
  while (began === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(instance.cancel(RUN_ID), true);
  release();
  const cancelled = await started;
  assert.equal(cancelled.status, "cancelled");
  assert.ok(began <= 4, `started ${began} businesses after cancellation`);
  assert.ok(cancelled.items.some((item) => item.phase === "pending"));
});

test("business timeout produces no negative content claim", async () => {
  let published = null;
  const run = await controller({
    businessTimeoutMs: 10,
    publish: async (action) => {
      published = action;
    },
    fetchPage: async (url, { signal }) => {
      if (url.endsWith("/robots.txt"))
        return { url, text: "User-agent: *", finalProtocol: "https:" };
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
      return null;
    },
  }).start({ selectedSignals: ["NO_ONLINE_BOOKING"], leads: [lead(1)] });
  assert.equal(run.items[0].phase, "completed");
  assert.equal(published.observations[0].state, "not_checked");
  assert.equal(published.observations[0].signal, "NO_ONLINE_BOOKING");
});

test("controller never fetches a follow-up path blocked by robots", async () => {
  const fetched = [];
  await controller({
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.endsWith("/robots.txt")) {
        return {
          url,
          text: "User-agent: *\nDisallow: /private",
          finalProtocol: "https:",
        };
      }
      if (url.endsWith("/")) {
        return {
          url,
          text: '<a href="/private/contact">Private</a><a href="/about">About</a>',
          finalProtocol: "https:",
        };
      }
      return { url, text: "<meta name=viewport>", finalProtocol: "https:" };
    },
  }).start({ selectedSignals: ["HAS_WHATSAPP_LINK"], leads: [lead(1)] });
  assert.ok(fetched.some((url) => url.endsWith("/about")));
  assert.equal(
    fetched.some((url) => url.endsWith("/private/contact")),
    false,
  );
});
