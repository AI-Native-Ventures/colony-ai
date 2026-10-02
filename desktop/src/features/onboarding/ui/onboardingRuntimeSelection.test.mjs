import assert from "node:assert/strict";
import test from "node:test";

import {
  getReadyOnboardingRuntimes,
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
  runtimeIsVisibleInOnboarding,
} from "./onboardingRuntimeSelection.ts";

function runtime(id, availability, status) {
  return { id, availability, authStatus: { status } };
}

test("the V3 harness catalog is visible in onboarding", () => {
  assert.equal(runtimeIsVisibleInOnboarding("claude"), true);
  assert.equal(runtimeIsVisibleInOnboarding("codex"), true);
  assert.equal(runtimeIsVisibleInOnboarding("goose"), true);
  assert.equal(runtimeIsVisibleInOnboarding("buzz-agent"), true);
  assert.equal(runtimeIsVisibleInOnboarding("cursor"), true);
  assert.equal(runtimeIsVisibleInOnboarding("openclaw"), true);
  assert.equal(runtimeIsVisibleInOnboarding("custom"), false);
});

test("visible onboarding runtimes use the product order", () => {
  const runtimes = [
    runtime("buzz-agent", "available", "not_applicable"),
    runtime("codex", "available", "logged_in"),
    runtime("goose", "available", "not_applicable"),
    runtime("claude", "available", "logged_in"),
  ];

  assert.deepEqual(
    getVisibleOnboardingRuntimes(runtimes).map(({ id }) => id),
    ["claude", "codex", "goose", "buzz-agent"],
  );
});

test("readiness requires an available and authenticated runtime", () => {
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("claude", "available", "logged_in")),
    true,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(
      runtime("codex", "available", "not_applicable"),
    ),
    true,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("claude", "available", "logged_out")),
    false,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("codex", "not_installed", "logged_in")),
    false,
  );
});

test("ready onboarding runtimes exclude unknown and non-ready harnesses", () => {
  const runtimes = [
    runtime("goose", "available", "not_applicable"),
    runtime("codex", "available", "logged_out"),
    runtime("buzz-agent", "available", "not_applicable"),
    runtime("claude", "available", "logged_in"),
    runtime("custom", "available", "not_applicable"),
  ];

  assert.deepEqual(
    getReadyOnboardingRuntimes(runtimes).map(({ id }) => id),
    ["claude", "goose"],
  );
});

test("bundled onboarding readiness binds real provider/model/key readiness", () => {
  const bundled = runtime("buzz-agent", "available", "not_applicable");
  assert.equal(runtimeIsReadyForOnboarding(bundled), false);
  for (const config of [
    { provider: null, model: null, env_vars: {} },
    { provider: "openrouter", model: "vendor/model", env_vars: {} },
    {
      provider: "openrouter",
      model: null,
      env_vars: { OPENROUTER_API_KEY: "fixture" },
    },
  ])
    assert.equal(runtimeIsReadyForOnboarding(bundled, config, null), false);
  assert.equal(
    runtimeIsReadyForOnboarding(
      bundled,
      {
        provider: "openrouter",
        model: "vendor/model",
        env_vars: { OPENROUTER_API_KEY: "fixture" },
      },
      null,
    ),
    true,
  );
});

test("configured bundled runtime must also pass native prerequisite readiness", () => {
  const bundled = runtime("buzz-agent", "available", "not_applicable");
  const config = {
    preferred_runtime: "buzz-agent",
    provider: "openrouter",
    model: "vendor/model",
    env_vars: { OPENROUTER_API_KEY: "fixture" },
  };
  assert.equal(runtimeIsReadyForOnboarding(bundled, config, undefined), false);
  assert.equal(
    runtimeIsReadyForOnboarding(bundled, config, { available: false }),
    false,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(bundled, config, { available: true }),
    true,
  );
  const runtimes = [bundled, runtime("claude", "available", "logged_in")];
  assert.deepEqual(
    getReadyOnboardingRuntimes(runtimes, config, { available: false }).map(
      ({ id }) => id,
    ),
    ["claude"],
  );
  assert.deepEqual(
    getReadyOnboardingRuntimes(runtimes, config, null).map(({ id }) => id),
    ["claude", "buzz-agent"],
  );
});
