import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createQualifyService,
  qualifyRunStorePath,
} from "./qualify-service.mjs";

const CHANNEL_ID = "c6c5417e-3361-4e4b-8cba-5e3c8576b405";
const COMMUNITY_ID = "e6c5417e-3361-4e4b-8cba-5e3c8576b405";
const RUN_ID = "d39cf188-319a-4efc-92cc-8c55c5f2d6d2";
const LEAD_ID = "9bb3be2c-4faa-4114-9b2d-d2ad6bd09b88";

function input(overrides = {}) {
  return {
    channelId: CHANNEL_ID,
    communityId: COMMUNITY_ID,
    leads: [{ leadId: LEAD_ID, website: null }],
    runId: RUN_ID,
    selectedSignals: ["NO_WEBSITE"],
    ...overrides,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for qualification run state.");
}

async function temporaryUserData() {
  return fs.mkdtemp(path.join(os.tmpdir(), "colony-qualify-service-"));
}

test("main service writes a run journal before reporting its first progress", async (t) => {
  const userDataPath = await temporaryUserData();
  t.after(() => fs.rm(userDataPath, { force: true, recursive: true }));
  const requests = [];
  const service = createQualifyService({
    userDataPath,
    requestRenderer: async (operation, payload) => {
      requests.push({ operation, payload });
      if (operation === "load_head") return null;
      return { eventId: "b".repeat(64) };
    },
  });

  const first = await service.start(input());
  assert.equal(first.runId, RUN_ID);
  const journal = JSON.parse(
    await fs.readFile(qualifyRunStorePath(userDataPath), "utf8"),
  );
  assert.ok(journal.runs[RUN_ID]);
  const complete = await waitFor(async () => {
    const snapshot = await service.snapshot({
      channelId: CHANNEL_ID,
      communityId: COMMUNITY_ID,
      runId: RUN_ID,
    });
    return snapshot?.status === "completed" ? snapshot : null;
  });
  assert.equal(complete.checked, 1);
  assert.deepEqual(
    requests.map(({ operation }) => operation),
    ["load_head", "publish"],
  );
  assert.ok(
    requests.every(
      ({ payload }) =>
        payload.channelId === CHANNEL_ID &&
        payload.communityId === COMMUNITY_ID,
    ),
  );
  service.dispose();
});

test("main service keeps a failed publish durable and resumes without refetching", async (t) => {
  const userDataPath = await temporaryUserData();
  t.after(() => fs.rm(userDataPath, { force: true, recursive: true }));
  let rejectPublish = true;
  const service = createQualifyService({
    userDataPath,
    requestRenderer: async (operation) => {
      if (operation === "load_head") return null;
      if (rejectPublish) throw new Error("relay publish failed");
      return { eventId: "c".repeat(64) };
    },
  });

  await service.start(input());
  const paused = await waitFor(async () => {
    const snapshot = await service.snapshot({
      channelId: CHANNEL_ID,
      communityId: COMMUNITY_ID,
      runId: RUN_ID,
    });
    return snapshot?.status === "paused" ? snapshot : null;
  });
  assert.equal(paused.failureReason, "relay publish failed");
  const journal = JSON.parse(
    await fs.readFile(qualifyRunStorePath(userDataPath), "utf8"),
  );
  assert.equal(journal.runs[RUN_ID].items[0].phase, "ready_to_publish");
  assert.ok(journal.runs[RUN_ID].items[0].action);

  rejectPublish = false;
  await service.resume({
    channelId: CHANNEL_ID,
    communityId: COMMUNITY_ID,
    runId: RUN_ID,
  });
  const complete = await waitFor(async () => {
    const snapshot = await service.snapshot({
      channelId: CHANNEL_ID,
      communityId: COMMUNITY_ID,
      runId: RUN_ID,
    });
    return snapshot?.status === "completed" ? snapshot : null;
  });
  assert.equal(complete.checked, 1);
  service.dispose();
});

test("main service exposes an orphaned running journal as resumable", async (t) => {
  const userDataPath = await temporaryUserData();
  t.after(() => fs.rm(userDataPath, { force: true, recursive: true }));
  await fs.writeFile(
    qualifyRunStorePath(userDataPath),
    JSON.stringify({
      schemaVersion: 1,
      runs: {
        [RUN_ID]: {
          schemaVersion: 1,
          runId: RUN_ID,
          status: "running",
          items: [
            {
              lead: { leadId: LEAD_ID, website: null },
              phase: "pending",
              action: null,
              lastError: null,
            },
          ],
        },
      },
    }),
  );
  const service = createQualifyService({
    userDataPath,
    requestRenderer: async () => null,
  });

  const snapshot = await service.snapshot({
    channelId: CHANNEL_ID,
    communityId: COMMUNITY_ID,
    runId: RUN_ID,
  });

  assert.equal(snapshot?.status, "paused");
  service.dispose();
});
