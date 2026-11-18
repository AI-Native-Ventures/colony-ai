import assert from "node:assert/strict";
import test from "node:test";

import source from "./prebuiltAgents.json" with { type: "json" };
import {
  buildPrebuiltAgentInstructions,
  PREBUILT_AGENT_RULES,
  PREBUILT_AGENTS,
  PREBUILT_HEADS,
  prebuiltBuiltInRole,
  prebuiltHeadForFunction,
} from "./prebuiltAgents.ts";

function escaped(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

test("the approved prebuilt source is present without omitted or rewritten agents", () => {
  assert.equal(PREBUILT_AGENTS.length, 25);
  assert.deepEqual(PREBUILT_AGENT_RULES, source.rules);
  assert.deepEqual(PREBUILT_AGENTS, source.agents);
  assert.equal(PREBUILT_HEADS.length, 5);
  assert.deepEqual(
    PREBUILT_HEADS.map((agent) => agent.part),
    ["sales", "operations", "customer_success", "finance", "brand"],
  );
});

test("each prebuilt agent stores every approved instruction", () => {
  for (const agent of PREBUILT_AGENTS) {
    const instructions = buildPrebuiltAgentInstructions(agent);
    assert.match(instructions, new RegExp(escaped(agent.name)));
    assert.match(instructions, new RegExp(agent.part));
    for (const line of [...agent.does, ...agent.asks, agent.firstMove]) {
      assert.ok(instructions.includes(line), `${agent.id}: ${line}`);
    }
    for (const rule of PREBUILT_AGENT_RULES) {
      assert.ok(instructions.includes(rule), `${agent.id}: ${rule}`);
    }
  }
});

test("only the approved head is exposed for each map part", () => {
  assert.equal(prebuiltHeadForFunction("finance")?.name, "Head of Finance");
  assert.equal(prebuiltHeadForFunction("operations")?.available, true);
  const head = prebuiltHeadForFunction("sales");
  assert.ok(head);
  const role = prebuiltBuiltInRole(head, "codex");
  assert.deepEqual(role.companyRole.workerMenu, ["codex"]);
  assert.ok(role.systemPrompt.includes("Head of Sales"));
});
