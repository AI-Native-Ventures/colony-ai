import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { prepareGateRun } from "./gate-run.mjs";
import {
  readPackagedGate,
  GATE_MARKER,
} from "../../../electron/browser-broker/packaged-gate.mjs";
import { drivePackagedRow } from "./row-driver.mjs";

const task = {
  agentId: "a".repeat(64),
  taskId: "conversation:11111111-1111-4111-8111-111111111111",
  businessId: "synthetic-business",
  clientId: null,
  communityOrigin: "http://127.0.0.1:4403",
};

test("real-run preparation produces the production gate's dual opt-in, FAKE only, and cleans fixtures", async (t) => {
  const run = await prepareGateRun({
    realHome: "/Users/synthetic-owner",
    relayOrigin: "ws://127.0.0.1:4403",
    task,
    modelPlan: [{}],
  });
  t.after(run.close);
  const config = JSON.parse(
    await readFile(path.join(run.home, GATE_MARKER), "utf8"),
  );
  assert.equal(config.nonce, run.environment.COLONY_BROWSER_PACKAGED_GATE);
  assert.equal(run.agentEnvironment.OPENAI_COMPAT_MODEL, "colony-browser-fake");
  assert.equal(run.environment.COLONY_NEST_MIGRATION, "0");
  assert.equal(Object.hasOwn(run.environment, "COLONY_BROWSER_AGENT"), false);
  const gate = await readPackagedGate(run.environment);
  assert.deepEqual(
    gate.exceptionsFor({ ...task, allowedOrigins: [run.fixtureOrigin] }),
    [new URL(run.fixtureOrigin).host],
  );
  assert.equal(await readPackagedGate({ HOME: run.home }), null);
  await rm(path.join(run.home, GATE_MARKER));
  await assert.rejects(readPackagedGate(run.environment), /ENOENT/u);
  await run.close();
  assert.equal(run.fixtures.listening(), false);
});

test("row driver blocks missing packaged or genuine managed proof before clicking UI", async () => {
  const blocked = await drivePackagedRow({
    id: "approve",
    page: null,
    run: null,
    managed: null,
    provenance: {},
  });
  assert.equal(blocked.status, "BLOCKED");
});
