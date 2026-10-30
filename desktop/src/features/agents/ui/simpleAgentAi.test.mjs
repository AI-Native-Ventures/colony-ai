import assert from "node:assert/strict";
import test from "node:test";

import { selectionOnRuntimeChange } from "./runtimeModelProviderSelection.ts";
import {
  acceptedEffortLabel,
  isClaudeSubscription,
  resolveSimpleAgentAi,
  simpleModelLabel,
  simpleProviderLabel,
} from "./simpleAgentAi.ts";

test("subscription usage requires Claude's Anthropic account login, not an API key", () => {
  assert.equal(
    isClaudeSubscription({ runtimeId: "claude", provider: null }),
    true,
  );
  assert.equal(
    isClaudeSubscription({ runtimeId: "claude", provider: "anthropic" }),
    true,
  );
  assert.equal(
    isClaudeSubscription({
      runtimeId: "claude",
      provider: "anthropic",
      envVars: { ANTHROPIC_API_KEY: "test-key" },
    }),
    false,
  );
  assert.equal(
    isClaudeSubscription({ runtimeId: "claude", provider: "openrouter" }),
    false,
  );
  assert.equal(
    isClaudeSubscription({ runtimeId: "codex", provider: "openai" }),
    false,
  );
});

test("Claude Code and Codex hide implied providers unless an owner key is configured", () => {
  assert.equal(
    simpleProviderLabel({ runtimeId: "claude", provider: "anthropic" }),
    null,
  );
  assert.equal(
    simpleProviderLabel({
      runtimeId: "claude",
      provider: "anthropic",
      envVars: { ANTHROPIC_API_KEY: "test-key" },
    }),
    "Anthropic",
  );
  assert.equal(
    simpleProviderLabel({ runtimeId: "codex", provider: "openai" }),
    null,
  );
  assert.equal(
    simpleProviderLabel({
      runtimeId: "codex",
      provider: "openai",
      envVars: { OPENAI_COMPAT_API_KEY: "test-key" },
    }),
    "OpenAI",
  );
});

test("providers remain visible when the harness does not imply them", () => {
  assert.equal(
    simpleProviderLabel({ runtimeId: "opencode", provider: "openrouter" }),
    "OpenRouter",
  );
  assert.equal(
    simpleProviderLabel({
      runtimeId: "buzz-agent",
      provider: "colony-credits",
    }),
    "Colony free AI",
  );
  assert.equal(
    simpleProviderLabel({ runtimeId: "custom", provider: null }),
    null,
  );
});

test("approved aliases and the provider-aware model registry produce full names", () => {
  assert.equal(simpleModelLabel(null), "Not reported");
  assert.equal(simpleModelLabel("[MODEL]"), "Not reported");
  assert.equal(simpleModelLabel("opus"), "Claude Opus 5.5");
  assert.equal(simpleModelLabel("claude-sonnet-5-5"), "Claude Sonnet 5.5");
  assert.equal(simpleModelLabel("gpt-4o", "openai"), "GPT-4o");
  assert.equal(simpleModelLabel("gpt-5.5", "openai"), "GPT-5.5");
  assert.equal(simpleModelLabel("gpt-6"), "GPT-6");
  assert.equal(simpleModelLabel("gpt-6-luna"), "GPT-6 Luna");
  assert.equal(
    simpleModelLabel(
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "colony-credits",
    ),
    "Nemotron 3 Ultra 550B A55B",
  );
  assert.equal(
    simpleModelLabel("google/gemma-4-31b-it:free", "colony-credits"),
    "Gemma 4 31B IT",
  );
  assert.equal(
    simpleModelLabel("claude-opus-4-5", "anthropic"),
    "Claude Opus 4.5",
  );
  assert.equal(
    simpleModelLabel("model:custom-provider", "custom-provider"),
    "model:custom-provider",
  );
});

test("profile and directory use the same observed model and provider precedence", () => {
  const config = {
    runtimeId: "buzz-agent",
    isPreSpawn: false,
    normalized: {
      model: { value: "nvidia/nemotron-3-ultra-550b-a55b:free" },
      provider: { value: "colony-credits" },
    },
  };
  assert.deepEqual(
    resolveSimpleAgentAi({
      runtimeId: "buzz-agent",
      config,
      agentModel: "[MODEL]",
      agentProvider: "anthropic",
      inheritedModel: "gpt-4o",
      inheritedProvider: "openai",
    }),
    {
      observed: true,
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      provider: "colony-credits",
    },
  );
  assert.deepEqual(
    resolveSimpleAgentAi({
      runtimeId: "claude",
      config,
      agentModel: "opus",
      agentProvider: "anthropic",
      inheritedModel: "gpt-4o",
      inheritedProvider: "openai",
    }),
    { observed: false, model: "opus", provider: "anthropic" },
  );
});

test("profile effort labels use only values advertised by the running adapter", () => {
  const claudeEfforts = [
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
    { value: "xhigh", displayName: "Extra high" },
    { value: "max", displayName: "Max" },
  ];
  const codexEfforts = [
    { value: "low" },
    { value: "medium" },
    { value: "high" },
  ];
  assert.equal(acceptedEffortLabel("high", claudeEfforts), "High");
  assert.equal(acceptedEffortLabel("xhigh", codexEfforts), null);
  assert.equal(acceptedEffortLabel("balanced", claudeEfforts), null);
  assert.equal(acceptedEffortLabel("high", undefined), null);
});

test("Colony Agent effort uses model capability values without ACP options", () => {
  const colonyAgent = {
    runtimeId: "buzz-agent",
    provider: "colony-credits",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
  };
  assert.equal(acceptedEffortLabel("high", undefined, colonyAgent), "high");
  assert.equal(acceptedEffortLabel("balanced", undefined, colonyAgent), null);
  assert.equal(acceptedEffortLabel("xhigh", undefined, colonyAgent), "xhigh");
});

test("changing harness clears the previous model and provider labels through the production transition", () => {
  const next = selectionOnRuntimeChange(
    {
      provider: "opencode-free",
      model: "opencode/deepseek-v4.1-flash-free",
      isCustomProviderEditing: false,
      isCustomModelEditing: false,
      envVars: {
        OPENROUTER_API_KEY: "test-key",
        BUZZ_AGENT_THINKING_EFFORT: "high",
      },
    },
    {
      previousRuntime: "opencode",
      nextRuntime: "claude",
      nextRuntimeCanChooseProvider: false,
      lockedRuntimeReset: "full",
    },
  );
  assert.equal(next.provider, "");
  assert.equal(next.model, "");
  assert.deepEqual(next.envVars, { OPENROUTER_API_KEY: "test-key" });
});
