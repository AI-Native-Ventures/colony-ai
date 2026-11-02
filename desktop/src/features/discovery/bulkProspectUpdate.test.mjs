import assert from "node:assert/strict";
import test from "node:test";

const {
  applyBulkProspectUpdate,
  bulkProspectUpdateStorageKey,
  readPendingBulkProspectUpdate,
} = await import("./bulkProspectUpdate.ts");

function harness({ failPublish = null, throwAfterPublish = false } = {}) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const heads = new Map(
    ["lead-a", "lead-b"].map((prospectId) => [
      prospectId,
      {
        eventId: `event-${prospectId}`,
        record: {
          prospectId,
          prospect: {
            prospectId,
            stage: "qualified",
            qualification: "qualified",
            lostReason: null,
          },
        },
      },
    ]),
  );
  const published = [];
  let attempts = 0;
  const dependencies = {
    storage,
    loadCurrent: async (id) => heads.get(id) ?? null,
    publish: async (current, target) => {
      attempts += 1;
      published.push(current.record.prospectId);
      if (failPublish === attempts) throw new Error("relay unavailable");
      const nextStage = target.kind === "mark-lost" ? "lost" : target.stage;
      current.record.prospect.stage = nextStage;
      if (target.kind === "mark-lost") {
        current.record.prospect.qualification = "not_fit";
        current.record.prospect.lostReason = "Not a fit";
      }
      if (throwAfterPublish && attempts === 1) {
        throw new Error("publish acknowledgment lost");
      }
    },
    exclusive: (_key, run) => run(),
    now: () => 42,
  };
  return { storage, heads, published, dependencies };
}

const input = {
  channelId: "sales-channel",
  communityId: "tenant-community",
  prospectIds: ["lead-a", "lead-b"],
  target: { kind: "stage", stage: "in_conversation" },
};

test("a partial bulk stage failure leaves a retry journal and resumes remaining leads", async () => {
  const state = harness({ failPublish: 2 });
  await assert.rejects(
    applyBulkProspectUpdate(input, state.dependencies),
    /relay unavailable/,
  );

  const key = bulkProspectUpdateStorageKey(input.channelId, input.communityId);
  const pending = readPendingBulkProspectUpdate(
    state.storage,
    input.channelId,
    input.communityId,
  );
  assert.deepEqual(pending.pendingProspectIds, ["lead-b"]);
  assert.equal(JSON.parse(state.storage.getItem(key)).schemaVersion, 1);

  const retryDependencies = {
    ...state.dependencies,
    publish: async (current, target) => {
      state.published.push(current.record.prospectId);
      current.record.prospect.stage = target.stage;
    },
  };
  await applyBulkProspectUpdate(input, retryDependencies);

  assert.deepEqual(state.published, ["lead-a", "lead-b", "lead-b"]);
  assert.equal(state.storage.getItem(key), null);
  assert.equal(
    state.heads.get("lead-a").record.prospect.stage,
    "in_conversation",
  );
  assert.equal(
    state.heads.get("lead-b").record.prospect.stage,
    "in_conversation",
  );
});

test("retry checks the latest head before publishing after a lost acknowledgment", async () => {
  const state = harness({ throwAfterPublish: true });
  await assert.rejects(
    applyBulkProspectUpdate(input, state.dependencies),
    /publish acknowledgment lost/,
  );

  const retryDependencies = {
    ...state.dependencies,
    publish: async (current, target) => {
      assert.equal(current.record.prospectId, "lead-b");
      current.record.prospect.stage = target.stage;
      state.published.push(current.record.prospectId);
    },
  };
  await applyBulkProspectUpdate(input, retryDependencies);

  assert.deepEqual(state.published, ["lead-a", "lead-b"]);
  assert.equal(
    readPendingBulkProspectUpdate(
      state.storage,
      input.channelId,
      input.communityId,
    ),
    null,
  );
});

test("a different bulk action cannot replace the saved retry operation", async () => {
  const state = harness({ failPublish: 1 });
  await assert.rejects(
    applyBulkProspectUpdate(input, state.dependencies),
    /relay unavailable/,
  );
  await assert.rejects(
    applyBulkProspectUpdate(
      { ...input, target: { kind: "stage", stage: "won" } },
      state.dependencies,
    ),
    /Finish the saved update/,
  );
  assert.deepEqual(state.published, ["lead-a"]);
});

test("storage must persist the journal before the first relay write", async () => {
  const state = harness();
  state.dependencies.storage.setItem = () => {
    throw new Error("quota full");
  };
  await assert.rejects(
    applyBulkProspectUpdate(input, state.dependencies),
    /Could not save a retry record/,
  );
  assert.deepEqual(state.published, []);
});
