import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime.ts";
import {
  buildStartFreeConfig,
  OnboardingConnectionError,
  onboardingFailureCopy,
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

const FREE_LIMIT_COPY =
  "Today's free AI limit is used up. Connect your own AI in Settings > Agents, or try again later.";
const OPENCODE_FREE_LIMIT =
  "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going";

test("a failed Connect proof says the free limit is used up, never that the AI is busy", () => {
  // The native test names it with a code and the plain copy...
  assert.equal(
    onboardingFailureCopy(
      new OnboardingConnectionError(FREE_LIMIT_COPY, "free_limit_reached"),
    ),
    FREE_LIMIT_COPY,
  );
  // ...or only quotes OpenCode's own words.
  assert.equal(
    onboardingFailureCopy(new OnboardingConnectionError(OPENCODE_FREE_LIMIT)),
    FREE_LIMIT_COPY,
  );
  assert.equal(
    onboardingFailureCopy(new Error(OPENCODE_FREE_LIMIT)),
    FREE_LIMIT_COPY,
  );
  // Other failures keep their own words.
  const busy =
    "Your AI is busy and did not answer. Try again in a minute, or choose another connection.";
  assert.equal(
    onboardingFailureCopy(new OnboardingConnectionError(busy)),
    busy,
  );
  assert.equal(onboardingFailureCopy(new Error("network")), "network");
});

test("the free limit is not the 'free model ended' state", () => {
  assert.equal(
    startFreeFailureKind(
      new OnboardingConnectionError(FREE_LIMIT_COPY, "free_limit_reached"),
    ),
    "other",
  );
});
