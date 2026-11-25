import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPlacementAction,
  classifyPlacementError,
  createPlacementPublisher,
  PlacementRefusal,
} from "./publishPlacement.ts";

const AGENT = "AB".repeat(32);

describe("placement action", () => {
  it("flip_publishes_cas_action: the content is the contract's setHome command", () => {
    assert.deepEqual(
      buildPlacementAction({
        agent: AGENT,
        op: "setHome",
        expectedGeneration: 3,
        home: "cloud",
      }),
      {
        schema: 1,
        agent: "ab".repeat(32),
        op: "setHome",
        home: "cloud",
        expectedGeneration: 3,
        cloudModel: null,
      },
    );
  });

  it("retryWake carries no home; setCloudModel carries the model", () => {
    const retry = buildPlacementAction({
      agent: AGENT,
      op: "retryWake",
      expectedGeneration: 4,
    });
    assert.equal("home" in retry, false);
    const model = buildPlacementAction({
      agent: AGENT,
      op: "setCloudModel",
      expectedGeneration: 4,
      cloudModel: "deepseek/deepseek-v4.1-flash",
    });
    assert.equal(model.cloudModel, "deepseek/deepseek-v4.1-flash");
  });
});

describe("placement refusals", () => {
  it("cap_message_shows_limit: reads the limit out of cloud_limit:{n}", () => {
    const refusal = classifyPlacementError(
      new Error("rejected: cloud_limit:2"),
    );
    assert.ok(refusal instanceof PlacementRefusal);
    assert.equal(refusal.code, "cloud_limit");
    assert.equal(refusal.limit, 2);
  });

  it("conflict_refetches: a stale generation is its own code", () => {
    assert.equal(
      classifyPlacementError(new Error("rejected: generation_conflict")).code,
      "generation_conflict",
    );
  });

  it("knows not cloud-ready and not allowed", () => {
    assert.equal(
      classifyPlacementError(new Error("not_cloud_ready")).code,
      "not_cloud_ready",
    );
    assert.equal(
      classifyPlacementError(new Error("restricted: only the owner")).code,
      "not_allowed",
    );
  });

  it("anything else keeps the relay's own words", () => {
    const refusal = classifyPlacementError(new Error("Timed out"));
    assert.equal(refusal.code, "other");
    assert.equal(refusal.message, "Timed out");
    assert.equal(classifyPlacementError("boom").code, "other");
  });
});

function publisher({ publishError = null } = {}) {
  const log = { signed: [], published: [], refetched: [] };
  const publish = createPlacementPublisher({
    sign: async (input) => {
      log.signed.push(input);
      return { id: "evt", ...input };
    },
    publish: async (event) => {
      log.published.push(event);
      if (publishError) throw publishError;
    },
    refetch: async (agents) => {
      log.refetched.push(agents);
    },
  });
  return { publish, log };
}

describe("placement publisher", () => {
  it("flip_publishes_cas_action: signs kind 47071 with the expected generation and reads the head after", async () => {
    const { publish, log } = publisher();
    await publish(AGENT, "setHome", 3, "cloud");
    assert.equal(log.signed.length, 1);
    assert.equal(log.signed[0].kind, 47071);
    assert.deepEqual(log.signed[0].tags, [["d", "ab".repeat(32)]]);
    const content = JSON.parse(log.signed[0].content);
    assert.equal(content.expectedGeneration, 3);
    assert.equal(content.home, "cloud");
    assert.equal(log.published.length, 1);
    assert.deepEqual(log.refetched, [[AGENT]]);
  });

  it("conflict_refetches: a stale generation reads the real placement and throws the conflict", async () => {
    const { publish, log } = publisher({
      publishError: new Error("rejected: generation_conflict"),
    });
    await assert.rejects(publish(AGENT, "setHome", 3, "cloud"), (error) => {
      assert.ok(error instanceof PlacementRefusal);
      assert.equal(error.code, "generation_conflict");
      return true;
    });
    assert.deepEqual(
      log.refetched,
      [[AGENT]],
      "the current home is read again",
    );
  });

  it("a refusal that is not a conflict does not pretend the home moved", async () => {
    const { publish, log } = publisher({
      publishError: new Error("rejected: cloud_limit:2"),
    });
    await assert.rejects(publish(AGENT, "setHome", 3, "cloud"), (error) => {
      assert.equal(error.code, "cloud_limit");
      assert.equal(error.limit, 2);
      return true;
    });
    assert.deepEqual(log.refetched, []);
  });
});
