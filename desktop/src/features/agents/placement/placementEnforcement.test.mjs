import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  macMayStartAgent,
  planPlacementActions,
} from "./placementEnforcement.ts";

const SCOUT = "a".repeat(64);
const agent = (status, backend = "local") => ({
  pubkey: SCOUT,
  name: "Scout",
  status,
  backend: { type: backend },
});
const placement = (home, generation) => ({
  home,
  generation,
  status: home === "cloud" ? "asleep" : null,
  cloudReady: true,
  cloudModel: null,
  configVersion: 1,
});
const change = (before, after) => ({ pubkey: SCOUT, before, after });

describe("placement enforcement", () => {
  it("stops a running local harness when the agent moves to the cloud", () => {
    assert.deepEqual(
      planPlacementActions(
        [change(placement("mac", 0), placement("cloud", 1))],
        [agent("running")],
      ),
      [{ pubkey: SCOUT, action: "stop" }],
    );
  });

  it("starts the harness when the agent moves back to the Mac", () => {
    assert.deepEqual(
      planPlacementActions(
        [change(placement("cloud", 1), placement("mac", 2))],
        [agent("stopped")],
      ),
      [{ pubkey: SCOUT, action: "start" }],
    );
  });

  it("does nothing for a status refresh inside one placement", () => {
    assert.deepEqual(
      planPlacementActions(
        [
          change(placement("cloud", 1), {
            ...placement("cloud", 1),
            status: "working",
          }),
        ],
        [agent("stopped")],
      ),
      [],
    );
  });

  it("does not start an agent that was already on the Mac when the app opened", () => {
    assert.deepEqual(
      planPlacementActions(
        [change(placement("mac", 0), placement("mac", 3))],
        [agent("stopped")],
      ),
      [],
    );
  });

  it("leaves an already stopped agent alone when it moves to the cloud", () => {
    assert.deepEqual(
      planPlacementActions(
        [change(placement("mac", 0), placement("cloud", 1))],
        [agent("stopped")],
      ),
      [],
    );
  });

  it("never touches a provider-backed or unknown agent", () => {
    assert.deepEqual(
      planPlacementActions(
        [change(placement("mac", 0), placement("cloud", 1))],
        [agent("deployed", "provider")],
      ),
      [],
    );
    assert.deepEqual(
      planPlacementActions(
        [
          {
            pubkey: "b".repeat(64),
            before: placement("mac", 0),
            after: placement("cloud", 1),
          },
        ],
        [agent("running")],
      ),
      [],
    );
  });
});

describe("hand starts on the Mac", () => {
  it("are allowed for a Mac-homed agent and refused for a cloud-homed one", () => {
    assert.equal(macMayStartAgent("mac"), true);
    assert.equal(macMayStartAgent("cloud"), false);
  });
});
