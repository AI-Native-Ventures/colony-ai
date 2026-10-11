import assert from "node:assert/strict";
import test from "node:test";

import {
  getOnboardingSubscriptionRuntimes,
  getReadyOnboardingRuntimes,
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
  runtimeIsVisibleInOnboarding,
} from "./onboardingRuntimeSelection.ts";

function runtime(id, availability, status) {
  return {
    id,
    availability,
    command: id,
    binaryPath: `/usr/local/bin/${id}`,
    authStatus: { status },
  };
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

test("the Connect step lists only Claude Code and Codex as subscriptions", () => {
  const runtimes = [
    runtime("buzz-agent", "available", "not_applicable"),
    runtime("goose", "available", "logged_in"),
    runtime("codex", "adapter_missing", "unknown"),
    runtime("opencode", "available", "logged_in"),
    runtime("claude", "not_installed", "unknown"),
    runtime("cursor", "available", "logged_in"),
  ];

  assert.deepEqual(
    getOnboardingSubscriptionRuntimes(runtimes).map(({ id }) => id),
    ["claude", "codex"],
  );
  assert.deepEqual(
    getOnboardingSubscriptionRuntimes(
      runtimes.filter(({ id }) => id !== "claude"),
    ).map(({ id }) => id),
    ["codex"],
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
    false,
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
    ["claude"],
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

test("unprobed provider harnesses and missing executable paths cannot be ready", () => {
  for (const id of ["goose", "omp", "grok"]) {
    for (const auth of [
      "unknown",
      "not_applicable",
      "logged_out",
      "config_invalid",
    ]) {
      assert.equal(
        runtimeIsReadyForOnboarding(runtime(id, "available", auth)),
        false,
      );
    }
    assert.equal(
      runtimeIsReadyForOnboarding(runtime(id, "available", "logged_in")),
      true,
    );
  }
  assert.equal(
    runtimeIsReadyForOnboarding({
      ...runtime("codex", "available", "logged_in"),
      binaryPath: null,
    }),
    false,
  );
  assert.equal(
    runtimeIsReadyForOnboarding({
      ...runtime("codex", "available", "logged_in"),
      command: null,
    }),
    false,
  );
});

for (const id of [
  "claude",
  "codex",
  "cursor",
  "devin",
  "omp",
  "grok",
  "opencode",
  "kimi",
  "amp",
  "hermes",
  "openclaw",
]) {
  test(`${id} is testable with its own authentication`, () => {
    assert.equal(
      runtimeIsReadyForOnboarding(runtime(id, "available", "logged_in")),
      true,
    );
    assert.equal(
      runtimeIsReadyForOnboarding(runtime(id, "available", "logged_out")),
      false,
    );
  });
}

test("buzz-agent requires provider model and credentials", () => {
  const entry = runtime("buzz-agent", "available", "not_applicable");
  assert.equal(
    runtimeIsReadyForOnboarding(
      entry,
      { env_vars: {}, provider: null, model: null },
      null,
    ),
    false,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(
      entry,
      {
        env_vars: { ANTHROPIC_API_KEY: "fixture" },
        provider: "anthropic",
        model: "model",
      },
      null,
    ),
    true,
  );
});

// Launch decision (desktop/src/features/agents/AGENTS.md): Goose provider,
// model and credentials alone cannot establish readiness while its sign-in is
// unprobed. This replaces the first-reply lane's provider-runtime Goose case.
test("goose with a complete provider config is still unready without a known sign-in", () => {
  const entry = runtime("goose", "available", "not_applicable");
  assert.equal(
    runtimeIsReadyForOnboarding(
      entry,
      {
        env_vars: { ANTHROPIC_API_KEY: "fixture" },
        provider: "anthropic",
        model: "model",
      },
      null,
    ),
    false,
  );
});

test("switching from a CLI cannot borrow its model or provider as bundled readiness", () => {
  assert.equal(
    runtimeIsReadyForOnboarding(
      runtime("buzz-agent", "available", "not_applicable"),
      {
        preferred_runtime: "claude",
        model: "cli-model",
        provider: "anthropic",
        env_vars: { ANTHROPIC_API_KEY: "fixture" },
      },
      null,
    ),
    false,
  );
});
