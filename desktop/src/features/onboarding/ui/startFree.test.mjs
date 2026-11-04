import assert from "node:assert/strict";
import test from "node:test";

import { connectColonyFreeAi } from "@/features/credits/creditsGateway";
import { buildOnboardingRuntimeCandidate } from "./saveOnboardingRuntime.ts";
import {
  buildStartFreeConfig,
  OnboardingConnectionError,
  onboardingFailureCopy,
  START_FREE_PROVIDER,
  START_FREE_RUNTIME_ID,
  startFreeFailureKind,
} from "./startFree.ts";

const savedOwnAi = {
  preferred_runtime: "claude",
  provider: "openrouter",
  model: "x",
  env_vars: { KEEP: "1" },
};

test("buildStartFreeConfig selects Colony's bundled agent and free model", () => {
  const config = buildStartFreeConfig(savedOwnAi, "openai/gpt-4.1-mini:free");
  assert.equal(config.preferred_runtime, "buzz-agent");
  assert.equal(config.provider, "colony-credits");
  assert.equal(config.model, "openai/gpt-4.1-mini:free");
  assert.deepEqual(config.env_vars, { KEEP: "1" });
});

test("the onboarding candidate keeps Colony's free provider and model", () => {
  const candidate = buildOnboardingRuntimeCandidate(
    buildStartFreeConfig(savedOwnAi, "openai/gpt-4.1-mini:free"),
    START_FREE_RUNTIME_ID,
    [{ id: "buzz-agent", availability: "available" }],
    undefined,
  );
  assert.equal(candidate.provider, START_FREE_PROVIDER);
  assert.equal(candidate.model, "openai/gpt-4.1-mini:free");
});

test("Start free uses only the relay free-model route and reads no balance", async () => {
  let proved;
  let balanceReads = 0;
  await connectColonyFreeAi(
    async (candidate) => {
      proved = candidate;
    },
    () => true,
    {
      models: async () => ["openai/gpt-4.1-mini:free"],
      config: async () => savedOwnAi,
      balance: async () => {
        balanceReads += 1;
        throw new Error("Start free must not read a paid balance");
      },
    },
  );
  assert.equal(proved?.preferred_runtime, "buzz-agent");
  assert.equal(proved?.provider, "colony-credits");
  assert.equal(proved?.model, "openai/gpt-4.1-mini:free");
  assert.equal(balanceReads, 0);
});

test("buildStartFreeConfig rejects models outside the free suffix", () => {
  assert.throws(
    () => buildStartFreeConfig(savedOwnAi, "openai/gpt-4.1-mini"),
    /configured free model/,
  );
});

test("startFreeFailureKind maps model_unavailable to the unavailable state", () => {
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
const OLD_PROVIDER_LIMIT_COPY =
  "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going";

test("free limit errors keep clear copy and never mention a subscription", () => {
  assert.equal(
    onboardingFailureCopy(
      new OnboardingConnectionError(FREE_LIMIT_COPY, "free_limit_reached"),
    ),
    FREE_LIMIT_COPY,
  );
  // The native provider may also return a message without a code.
  assert.equal(
    onboardingFailureCopy(
      new OnboardingConnectionError(OLD_PROVIDER_LIMIT_COPY),
    ),
    FREE_LIMIT_COPY,
  );
  assert.equal(
    onboardingFailureCopy(new Error(OLD_PROVIDER_LIMIT_COPY)),
    FREE_LIMIT_COPY,
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
