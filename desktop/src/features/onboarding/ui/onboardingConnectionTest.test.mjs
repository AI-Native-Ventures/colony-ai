import assert from "node:assert/strict";
import test from "node:test";
import { runOnboardingConnectionTest } from "./onboardingConnectionTest.ts";
const config = {
  preferred_runtime: "claude",
  model: null,
  provider: null,
  env_vars: {},
};
test("a real reply pins the negotiated model for starter launch", async () => {
  let persisted;
  const result = await runOnboardingConnectionTest(
    config,
    () => true,
    async (input) => {
      assert.deepEqual(input, config);
      return {
        reply: "Hello",
        model: "actual-model",
        startupMs: 20,
        totalMs: 50,
      };
    },
    async (input) => {
      persisted = input;
      return { config: input };
    },
  );
  assert.equal(result.proof.reply, "Hello");
  assert.equal(persisted.model, "actual-model");
});
test("failed, empty and stale replies cannot establish success or persist a model", async () => {
  for (const [proof, current, expected] of [
    [
      { error: "Provider rejected authentication. Sign in again." },
      true,
      /rejected authentication/,
    ],
    [{ reply: "  ", model: "model" }, true, /no reply/],
    [{ reply: "Hello", model: "model" }, false, /cancelled/],
  ])
    await assert.rejects(
      runOnboardingConnectionTest(
        config,
        () => current,
        async () => proof,
        async () => assert.fail("must not persist"),
      ),
      expected,
    );
});
test("a persistence failure cannot unlock connected", async () => {
  await assert.rejects(
    runOnboardingConnectionTest(
      config,
      () => true,
      async () => ({ reply: "Hello", model: "model" }),
      async () => {
        throw new Error("disk full");
      },
    ),
    /disk full/,
  );
});
