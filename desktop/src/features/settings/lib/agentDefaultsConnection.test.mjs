import assert from "node:assert/strict";
import test from "node:test";
import { agentDefaultsConnection } from "./agentDefaultsConnection.ts";
const config = {
  preferred_runtime: "claude",
  provider: null,
  model: null,
  env_vars: {},
};
const runtime = {
  id: "claude",
  label: "Claude Code",
  availability: "available",
  providerEnvVar: null,
  authStatus: { status: "logged_in" },
};
test("only the saved runtime's reported authentication establishes a subscription", () => {
  assert.equal(
    agentDefaultsConnection(config, [runtime]).label,
    "Claude Code subscription connected",
  );
  for (const status of ["unknown", "logged_out", "config_invalid"])
    assert.equal(
      agentDefaultsConnection(config, [{ ...runtime, authStatus: { status } }])
        .kind,
      "unknown",
    );
  assert.equal(
    agentDefaultsConnection({ ...config, preferred_runtime: "missing" }, [
      runtime,
    ]).kind,
    "unknown",
  );
  assert.equal(
    agentDefaultsConnection(config, [
      { ...runtime, availability: "not_installed" },
    ]).kind,
    "unavailable",
  );
});
test("provider credentials alone never claim a tested connection", () => {
  const providerRuntime = {
    ...runtime,
    id: "buzz-agent",
    label: "Colony Agent",
    providerEnvVar: "BUZZ_AGENT_PROVIDER",
    authStatus: { status: "not_applicable" },
  };
  const saved = {
    ...config,
    preferred_runtime: "buzz-agent",
    provider: "openrouter",
    model: "chosen-model",
    env_vars: { OPENROUTER_API_KEY: "non-secret-test-fixture" },
  };
  assert.equal(
    agentDefaultsConnection(saved, [providerRuntime]).label,
    "Own key configured",
  );
  assert.match(
    agentDefaultsConnection(saved, [providerRuntime]).detail,
    /not tested/,
  );
  assert.equal(
    agentDefaultsConnection({ ...saved, env_vars: {} }, [providerRuntime]).kind,
    "unknown",
  );
  assert.equal(
    agentDefaultsConnection(saved, [providerRuntime], {
      status: "connected",
      model: "chosen-model",
    }).label,
    "OpenRouter connected",
  );
  assert.equal(
    agentDefaultsConnection(saved, [providerRuntime], {
      status: "linked",
      model: "chosen-model",
    }).kind,
    "key",
  );
  assert.equal(
    agentDefaultsConnection(saved, [providerRuntime], {
      status: "connected",
      model: "chosen-model",
      testResult: "error",
    }).kind,
    "key",
  );
});
