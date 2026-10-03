import assert from "node:assert/strict";
import test from "node:test";
import { startWelcomeAgentsForKickoff } from "./welcomeStartup.ts";

test("a stalled teammate start cannot hold a successful lead start", {
  timeout: 1000,
}, async () => {
  const lead = { pubkey: "lead" };
  const teammate = { pubkey: "teammate" };
  const invoked = [];
  const result = await startWelcomeAgentsForKickoff(
    [lead, teammate],
    "lead",
    async (agent) => {
      invoked.push(agent.pubkey);
      if (agent === teammate) return new Promise(() => {});
      return lead;
    },
    () => assert.fail("no failure expected"),
  );
  assert.equal((await result.starts.get("lead")).status, "fulfilled");
  assert.deepEqual(invoked, ["lead", "teammate"]);
  assert.equal(result.outcomes.has("teammate"), false);
});

test("a failed native start remains a failure outcome", async () => {
  const agent = { pubkey: "lead" };
  const failure = new Error("sign-in required");
  let recorded;
  const result = await startWelcomeAgentsForKickoff(
    [agent],
    "lead",
    async () => {
      throw failure;
    },
    (_, error) => {
      recorded = error;
    },
  );
  assert.deepEqual(await result.starts.get("lead"), {
    status: "rejected",
    reason: failure,
  });
  assert.equal(recorded, failure);
  assert.equal(result.outcomes.get("lead").status, "rejected");
});
