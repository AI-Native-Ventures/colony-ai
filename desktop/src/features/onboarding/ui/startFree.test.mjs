import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime.ts";
import {
  buildStartFreeConfig,
  OnboardingConnectionError,
  START_FREE_MODEL,
  startFreeFailureKind,
} from "./startFree.ts";

const savedOwnAi = {
  preferred_runtime: "claude",
  provider: "openrouter",
  model: "x",
  env_vars: { KEEP: "1" },
};

test("buildStartFreeConfig selects OpenCode, the free provider and the free model", () => {
  const config = buildStartFreeConfig(savedOwnAi);
  assert.equal(config.preferred_runtime, "opencode");
  assert.equal(config.provider, "opencode-free");
  assert.equal(config.model, START_FREE_MODEL);
  assert.equal(START_FREE_MODEL, "opencode/deepseek-v4.1-flash-free");
  assert.deepEqual(config.env_vars, { KEEP: "1" });
});

test("the onboarding candidate keeps the Start free provider and model", () => {
  const candidate = buildOnboardingRuntimeCandidate(
    buildStartFreeConfig(savedOwnAi),
    "opencode",
    [{ id: "opencode", availability: "available" }],
    undefined,
  );
  assert.equal(candidate.provider, "opencode-free");
  assert.equal(candidate.model, START_FREE_MODEL);
});

test("startFreeFailureKind maps the model_unavailable code to ended", () => {
  assert.equal(
    startFreeFailureKind(
      new OnboardingConnectionError("gone", "model_unavailable"),
    ),
    "ended",
  );
  assert.equal(
    startFreeFailureKind(new OnboardingConnectionError("other", undefined)),
    "other",
  );
  assert.equal(startFreeFailureKind(new Error("network")), "other");
});
