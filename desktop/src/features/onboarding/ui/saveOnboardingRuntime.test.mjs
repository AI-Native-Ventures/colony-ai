import assert from "node:assert/strict";
import test from "node:test";
import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime.ts";
const original = {
  preferred_runtime: "buzz-agent",
  model: "deepseek-chat",
  provider: "deepseek",
  env_vars: {},
};
const runtimes = ["claude", "buzz-agent"].map((id) => ({
  id,
  availability: "available",
}));
test("Connect builds a candidate without mutating the saved bundled configuration", () => {
  const candidate = buildOnboardingRuntimeCandidate(
    original,
    "claude",
    runtimes,
  );
  assert.equal(candidate.preferred_runtime, "claude");
  assert.equal(candidate.model, null);
  assert.equal(candidate.provider, null);
  assert.equal(original.model, "deepseek-chat");
});
test("any runtime change clears incompatible model and provider", () => {
  const candidate = buildOnboardingRuntimeCandidate(
    { ...original, preferred_runtime: "claude", model: "claude-model" },
    "buzz-agent",
    runtimes,
  );
  assert.equal(candidate.model, null);
  assert.equal(candidate.provider, null);
});
test("only an explicit selected model is pinned", () => {
  const candidate = buildOnboardingRuntimeCandidate(
    original,
    "claude",
    runtimes,
    "chosen-model",
  );
  assert.equal(candidate.model, "chosen-model");
  assert.equal(
    buildOnboardingRuntimeCandidate(original, "buzz-agent", runtimes, null)
      .model,
    null,
  );
});
test("an unavailable choice is refused before any write", () => {
  assert.throws(
    () => buildOnboardingRuntimeCandidate(original, "claude", []),
    /unavailable/,
  );
});

test("legacy bundled defaults with no preference remain a valid in-memory candidate", () => {
  const legacy = { ...original, preferred_runtime: null };
  assert.deepEqual(
    buildOnboardingRuntimeCandidate(legacy, "buzz-agent", runtimes),
    { ...original },
  );
});
