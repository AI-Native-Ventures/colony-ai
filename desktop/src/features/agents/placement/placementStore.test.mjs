import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  applyPlacements,
  getPlacement,
  isCloudPlaced,
  resetPlacementStore,
  subscribePlacements,
} from "./placementStore.ts";

const AGENT = "a".repeat(64);
const cloud = (generation, extra = {}) => ({
  home: "cloud",
  generation,
  status: "asleep",
  cloudReady: true,
  cloudModel: null,
  configVersion: 1,
  ...extra,
});
const mac = (generation) => ({
  home: "mac",
  generation,
  status: null,
  cloudReady: true,
  cloudModel: null,
  configVersion: 1,
});

describe("placement store", () => {
  beforeEach(() => resetPlacementStore());

  it("treats an unknown agent as mac", () => {
    assert.equal(isCloudPlaced(AGENT), false);
    assert.equal(getPlacement(AGENT).home, "mac");
    assert.equal(getPlacement(AGENT).generation, 0);
  });

  it("reports a cloud placed agent, case-insensitively", () => {
    applyPlacements(new Map([[AGENT, cloud(1)]]));
    assert.equal(isCloudPlaced(AGENT), true);
    assert.equal(isCloudPlaced(AGENT.toUpperCase()), true);
  });

  it("ignores a stale read: a lower generation never replaces a higher one", () => {
    applyPlacements(new Map([[AGENT, cloud(4)]]));
    applyPlacements(new Map([[AGENT, mac(3)]]));
    assert.equal(isCloudPlaced(AGENT), true);
    assert.equal(getPlacement(AGENT).generation, 4);
  });

  it("takes a newer generation, including a flip back to mac", () => {
    applyPlacements(new Map([[AGENT, cloud(4)]]));
    applyPlacements(new Map([[AGENT, mac(5)]]));
    assert.equal(isCloudPlaced(AGENT), false);
  });

  it("same generation updates status (the relay moves it asleep, waking, working)", () => {
    applyPlacements(new Map([[AGENT, cloud(4)]]));
    applyPlacements(new Map([[AGENT, cloud(4, { status: "working" })]]));
    assert.equal(getPlacement(AGENT).status, "working");
  });

  it("notifies subscribers only when something changed", () => {
    const seen = [];
    const off = subscribePlacements((changes) => seen.push(changes));
    applyPlacements(new Map([[AGENT, cloud(1)]]));
    applyPlacements(new Map([[AGENT, cloud(1)]]));
    applyPlacements(new Map([[AGENT, mac(2)]]));
    off();
    assert.equal(seen.length, 2);
    assert.deepEqual(
      seen[0].map((change) => [
        change.pubkey,
        change.before.home,
        change.after.home,
      ]),
      [[AGENT, "mac", "cloud"]],
    );
    assert.equal(seen[1][0].after.home, "mac");
  });

  it("reset forgets everything (community switch)", () => {
    applyPlacements(new Map([[AGENT, cloud(9)]]));
    resetPlacementStore();
    assert.equal(isCloudPlaced(AGENT), false);
    assert.equal(getPlacement(AGENT).generation, 0);
  });
});
