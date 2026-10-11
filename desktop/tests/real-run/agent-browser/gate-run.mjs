import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GATE_HOME_PREFIX,
  GATE_MARKER,
  GATE_TTL_MS,
  readPackagedGate,
} from "../../../electron/browser-broker/packaged-gate.mjs";
import { prepareEnvironment } from "./environment.mjs";
import { createAgentBrowserFixtures } from "./fixtures.mjs";

/** Prepare one row's fixtures and dual opt-in. Never launches an app or approves a task. */
export async function prepareGateRun({
  source = {},
  realHome,
  relayOrigin,
  task,
  modelPlan,
}) {
  const home = await realpath(
    await mkdtemp(path.join(os.tmpdir(), GATE_HOME_PREFIX)),
  );
  const fixtures = createAgentBrowserFixtures({ modelPlan });
  async function close() {
    await fixtures.close();
    await rm(home, { recursive: true, force: true });
  }
  try {
    await chmod(home, 0o700);
    const origins = await fixtures.start();
    const prepared = prepareEnvironment(source, {
      home,
      realHome,
      userDataDir: path.join(home, "profile"),
      relayOrigin,
      ...origins,
    });
    const nonce = randomBytes(32).toString("hex");
    const marker = {
      ...task,
      schema: 1,
      nonce,
      provider: "FAKE",
      origin: origins.fixtureOrigin,
      expiresAt: Date.now() + GATE_TTL_MS - 1000,
    };
    await writeFile(path.join(home, GATE_MARKER), JSON.stringify(marker), {
      mode: 0o600,
    });
    prepared.environment.COLONY_BROWSER_PACKAGED_GATE = nonce;
    prepared.environment.COLONY_NEST_MIGRATION = "0";
    // Exercise the production reader before handing a launch environment to the coordinator.
    await readPackagedGate(prepared.environment);
    return {
      ...prepared,
      ...origins,
      task: { ...task },
      home,
      fixtures,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
