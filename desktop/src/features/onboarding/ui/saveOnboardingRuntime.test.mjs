import assert from "node:assert/strict";
import test from "node:test";
import { saveOnboardingRuntime } from "./saveOnboardingRuntime.ts";

test("Connect persists Claude instead of the old bundled default", async () => {
  const config = {
    preferred_runtime: "buzz-agent",
    model: "deepseek-chat",
    provider: "deepseek",
    env_vars: {},
  };
  let written;
  await saveOnboardingRuntime(
    "claude",
    [{ id: "claude", availability: "available" }],
    async () => config,
    async (next) => {
      written = next;
      return { config: next };
    },
  );
  assert.deepEqual(written, {
    ...config,
    preferred_runtime: "claude",
    model: null,
    provider: null,
  });
});

test("Connect preserves a selected harness's existing model", async () => {
  const config = {
    preferred_runtime: "claude",
    model: "claude-sonnet",
    provider: null,
    env_vars: {},
  };
  const saved = await saveOnboardingRuntime(
    "claude",
    [{ id: "claude", availability: "available" }],
    async () => config,
    async (next) => ({ config: next }),
  );
  assert.deepEqual(saved.config, config);
});

test("Connect refuses unavailable selections and propagates persistence failures", async () => {
  await assert.rejects(
    saveOnboardingRuntime("claude", [], async () => assert.fail()),
    /unavailable/,
  );
  await assert.rejects(
    saveOnboardingRuntime(
      "claude",
      [{ id: "claude", availability: "available" }],
      async () => ({ env_vars: {} }),
      async () => {
        throw new Error("disk full");
      },
    ),
    /disk full/,
  );
});
