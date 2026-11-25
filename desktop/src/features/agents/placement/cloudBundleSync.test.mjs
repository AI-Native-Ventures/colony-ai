import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emptySyncEntry,
  MAX_UPLOAD_ATTEMPTS,
  planBundleUploads,
  recordUploadResult,
  UPLOAD_RETRY_DELAYS_MS,
  UPLOAD_SETTLE_MS,
} from "./cloudBundleSync.ts";

const SCOUT = "a".repeat(64);
const NOVA = "b".repeat(64);
const ALLOWED = {
  enabled: true,
  allowed: true,
  maxPerAccount: 2,
  models: ["m"],
  defaultModel: "m",
};
const agent = (pubkey, updatedAt = "t1", backend = "local") => ({
  pubkey,
  name: pubkey === SCOUT ? "Scout" : "Nova",
  updatedAt,
  backend: { type: backend },
});
const placement = (cloudReady, configVersion = 0) => ({
  home: "mac",
  generation: 0,
  status: null,
  cloudReady,
  cloudModel: null,
  configVersion,
});
const plan = (overrides = {}) =>
  planBundleUploads({
    agents: [agent(SCOUT)],
    placements: new Map(),
    capabilities: ALLOWED,
    state: new Map(),
    now: 1_000,
    ...overrides,
  });

describe("cloud bundle sync", () => {
  it("sync_uploads_only_stale_agents: an agent the relay lacks is uploaded", () => {
    assert.deepEqual(plan(), [
      {
        pubkey: SCOUT,
        fingerprint: "t1",
        relayReady: false,
        relayConfigVersion: 0,
      },
    ]);
  });

  it("sync_uploads_only_stale_agents: a ready, unchanged agent is left alone", () => {
    const state = new Map([
      [SCOUT, { ...emptySyncEntry(), uploadedFingerprint: "t1" }],
    ]);
    assert.deepEqual(
      plan({ state, placements: new Map([[SCOUT, placement(true, 5)]]) }),
      [],
    );
  });

  it("sync_uploads_only_stale_agents: an edited agent is uploaded again", () => {
    const state = new Map([
      [SCOUT, { ...emptySyncEntry(), uploadedFingerprint: "t1" }],
    ]);
    const [upload] = plan({
      agents: [agent(SCOUT, "t2")],
      state,
      placements: new Map([[SCOUT, placement(true, 5)]]),
    });
    assert.equal(upload.fingerprint, "t2");
    assert.equal(upload.relayReady, true);
    assert.equal(upload.relayConfigVersion, 5);
  });

  it("sync_uploads_only_stale_agents: one stale agent among ready ones", () => {
    const state = new Map([
      [SCOUT, { ...emptySyncEntry(), uploadedFingerprint: "t1" }],
      [NOVA, { ...emptySyncEntry(), uploadedFingerprint: "t1" }],
    ]);
    const uploads = plan({
      agents: [agent(SCOUT), agent(NOVA, "t9")],
      state,
      placements: new Map([
        [SCOUT, placement(true, 5)],
        [NOVA, placement(true, 5)],
      ]),
    });
    assert.deepEqual(
      uploads.map((upload) => upload.pubkey),
      [NOVA],
    );
  });

  it("a relay that lost the agent gets it again even if nothing changed", () => {
    const state = new Map([
      [SCOUT, { ...emptySyncEntry(), uploadedFingerprint: "t1" }],
    ]);
    assert.equal(
      plan({
        state,
        placements: new Map([[SCOUT, placement(false)]]),
        now: UPLOAD_SETTLE_MS + 1_000,
      }).length,
      1,
    );
  });

  it("an upload that just landed is not repeated while the head catches up", () => {
    const state = new Map([
      [
        SCOUT,
        { ...emptySyncEntry(), uploadedFingerprint: "t1", uploadedAt: 1_000 },
      ],
    ]);
    const placements = new Map([[SCOUT, placement(false)]]);
    assert.equal(plan({ state, placements, now: 1_000 + 5_000 }).length, 0);
    assert.equal(
      plan({ state, placements, now: 1_000 + UPLOAD_SETTLE_MS }).length,
      1,
      "a relay that never reported it ready is topped up",
    );
  });

  it("upload_skipped_when_not_allowed: nothing is planned unless the relay says allowed", () => {
    assert.deepEqual(plan({ capabilities: null }), []);
    assert.deepEqual(plan({ capabilities: undefined }), []);
    assert.deepEqual(
      plan({ capabilities: { ...ALLOWED, allowed: false } }),
      [],
    );
    assert.deepEqual(
      plan({ capabilities: { ...ALLOWED, enabled: false } }),
      [],
    );
  });

  it("never plans a provider-backed agent", () => {
    assert.deepEqual(plan({ agents: [agent(SCOUT, "t1", "provider")] }), []);
  });

  it("a failed upload waits, retries a bounded number of times, then stops", () => {
    const upload = plan()[0];
    let entry = recordUploadResult(undefined, upload, "failed", 1_000);
    assert.equal(entry.failures, 1);
    assert.equal(entry.retryAt, 1_000 + UPLOAD_RETRY_DELAYS_MS[0]);
    let state = new Map([[SCOUT, entry]]);
    assert.equal(plan({ state, now: 1_000 + 10 }).length, 0, "still waiting");
    assert.equal(
      plan({ state, now: 1_000 + UPLOAD_RETRY_DELAYS_MS[0] }).length,
      1,
      "the wait is over",
    );
    for (let attempt = 1; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      entry = recordUploadResult(
        state.get(SCOUT),
        upload,
        "failed",
        10_000_000,
      );
      state = new Map([[SCOUT, entry]]);
    }
    assert.equal(entry.failures, MAX_UPLOAD_ATTEMPTS);
    assert.equal(
      plan({ state, now: Number.MAX_SAFE_INTEGER }).length,
      0,
      "no endless loop",
    );
  });

  it("an edit after giving up starts the tries again", () => {
    const upload = plan()[0];
    let entry;
    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      entry = recordUploadResult(entry, upload, "failed", 0);
    }
    const state = new Map([[SCOUT, entry]]);
    assert.equal(plan({ state, now: 1e12 }).length, 0);
    assert.equal(
      plan({ state, now: 1e12, agents: [agent(SCOUT, "t2")] }).length,
      1,
    );
  });

  it("a success clears the failures", () => {
    const upload = plan()[0];
    const failed = recordUploadResult(undefined, upload, "failed", 0);
    const ok = recordUploadResult(failed, upload, "ok", 5);
    assert.deepEqual(ok, {
      uploadedFingerprint: "t1",
      uploadedAt: 5,
      failures: 0,
      failedFingerprint: null,
      retryAt: 0,
    });
  });
});
