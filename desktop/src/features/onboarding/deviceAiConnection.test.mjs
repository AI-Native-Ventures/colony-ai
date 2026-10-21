import assert from "node:assert/strict";
import test from "node:test";

import {
  hasWorkingAiConnection,
  readDeviceAiConnection,
  waitForDeviceAiConnection,
} from "./deviceAiConnection.ts";

const emptyConfig = {
  env_vars: {},
  provider: null,
  model: null,
  preferred_runtime: null,
};
const claudeConfig = { ...emptyConfig, preferred_runtime: "claude" };
const claude = (status, availability = "available") => ({
  id: "claude",
  label: "Claude Code",
  availability,
  providerEnvVar: null,
  authStatus: { status },
});
const opencode = {
  id: "opencode",
  label: "OpenCode",
  availability: "available",
  providerEnvVar: null,
  authStatus: { status: "not_applicable" },
};
const colonyAgent = {
  id: "buzz-agent",
  label: "Colony Agent",
  availability: "available",
  providerEnvVar: "BUZZ_AGENT_PROVIDER",
  authStatus: { status: "not_applicable" },
};

test("a device with no saved route has no working connection", () => {
  assert.equal(
    hasWorkingAiConnection(emptyConfig, [claude("logged_in")]),
    false,
  );
});

test("working routes match the Your connection card", () => {
  assert.equal(
    hasWorkingAiConnection(claudeConfig, [claude("logged_in")]),
    true,
  );
  const startFree = {
    ...emptyConfig,
    preferred_runtime: "opencode",
    provider: "opencode-free",
    model: "opencode/deepseek-v4.1-flash-free",
  };
  assert.equal(hasWorkingAiConnection(startFree, [opencode]), true);
  const ownKey = {
    ...emptyConfig,
    preferred_runtime: "buzz-agent",
    provider: "openrouter",
    model: "chosen-model",
    env_vars: { OPENROUTER_API_KEY: "non-secret-test-fixture" },
  };
  assert.equal(hasWorkingAiConnection(ownKey, [colonyAgent]), true);
  const credits = {
    ...emptyConfig,
    preferred_runtime: "buzz-agent",
    provider: "colony-credits",
  };
  assert.equal(hasWorkingAiConnection(credits, [colonyAgent]), true);
});

test("unconfirmed, signed-out or missing routes are not working", () => {
  for (const status of ["logged_out", "unknown", "config_invalid"])
    assert.equal(hasWorkingAiConnection(claudeConfig, [claude(status)]), false);
  assert.equal(
    hasWorkingAiConnection(claudeConfig, [
      claude("logged_in", "not_installed"),
    ]),
    false,
  );
  assert.equal(hasWorkingAiConnection(claudeConfig, [opencode]), false);
  const keyless = {
    ...emptyConfig,
    preferred_runtime: "buzz-agent",
    provider: "openrouter",
    model: "chosen-model",
  };
  assert.equal(hasWorkingAiConnection(keyless, [colonyAgent]), false);
});

function fakeQueryClient({ config, runtimes }) {
  const calls = [];
  return {
    calls,
    async fetchQuery({ queryKey }) {
      calls.push(queryKey.join(":"));
      if (queryKey[0] === "globalAgentConfig") {
        if (config instanceof Error) throw config;
        return config;
      }
      if (runtimes instanceof Error) throw runtimes;
      return runtimes;
    },
    async cancelQueries() {},
    setQueryData() {},
  };
}

test("reading the device skips runtime probes when nothing is saved", async () => {
  const client = fakeQueryClient({
    config: emptyConfig,
    runtimes: [claude("logged_in")],
  });
  assert.equal(await readDeviceAiConnection(client), false);
  assert.deepEqual(client.calls, ["globalAgentConfig"]);
});

test("reading the device uses the forced catalog for a saved route", async () => {
  const signedIn = fakeQueryClient({
    config: claudeConfig,
    runtimes: [claude("logged_in")],
  });
  assert.equal(await readDeviceAiConnection(signedIn), true);
  assert.deepEqual(signedIn.calls, [
    "globalAgentConfig",
    "acp-runtimes:forced",
  ]);
  const signedOut = fakeQueryClient({
    config: claudeConfig,
    runtimes: [claude("logged_out")],
  });
  assert.equal(await readDeviceAiConnection(signedOut), false);
});

test("read failures answer no connection so Connect is shown", async () => {
  assert.equal(
    await readDeviceAiConnection(
      fakeQueryClient({ config: new Error("config unreadable"), runtimes: [] }),
    ),
    false,
  );
  assert.equal(
    await readDeviceAiConnection(
      fakeQueryClient({
        config: claudeConfig,
        runtimes: new Error("discovery failed"),
      }),
    ),
    false,
  );
});

test("waiting for the read is bounded", async () => {
  assert.equal(
    await waitForDeviceAiConnection(Promise.resolve(true), 50),
    true,
  );
  assert.equal(
    await waitForDeviceAiConnection(new Promise(() => {}), 10),
    false,
  );
});
