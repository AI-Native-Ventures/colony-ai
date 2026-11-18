import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import source from "./prebuiltAgents.json" with { type: "json" };
import { prebuiltAgentAvatarDataUrl } from "./prebuiltAgentAvatar.ts";
import {
  buildPrebuiltAgentInstructions,
  PREBUILT_AGENT_RULES,
  PREBUILT_AGENTS,
  PREBUILT_HEADS,
  prebuiltBuiltInRole,
  prebuiltHeadForFunction,
} from "./prebuiltAgents.ts";

const APPROVED_PREBUILT_SOURCE_SHA256 =
  "3ac4a3e4390b1394395be13c8ed682a333f0c21993d9d0cf9ce5ee6e93bedd52";

function escaped(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

test("the approved prebuilt source is present without omitted or rewritten agents", () => {
  assert.equal(PREBUILT_AGENTS.length, 25);
  assert.deepEqual(PREBUILT_AGENT_RULES, source.rules);
  assert.deepEqual(PREBUILT_AGENTS, source.agents);
  assert.equal(
    createHash("sha256").update(JSON.stringify(source)).digest("hex"),
    APPROVED_PREBUILT_SOURCE_SHA256,
  );
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
    assert.ok(agent.firstMessage.trim(), `${agent.id}: firstMessage`);
    assert.ok(
      !instructions.includes(agent.firstMessage),
      `${agent.id}: firstMessage must remain owner-visible only`,
    );
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

test("a prebuilt head keeps its colored ant as a self-contained avatar", () => {
  const finance = prebuiltHeadForFunction("finance");
  assert.ok(finance);

  const avatar = prebuiltAgentAvatarDataUrl(finance);
  assert.match(avatar, /^data:image\/svg\+xml,/);
  assert.match(decodeURIComponent(avatar), /#D9A83F/);
});
