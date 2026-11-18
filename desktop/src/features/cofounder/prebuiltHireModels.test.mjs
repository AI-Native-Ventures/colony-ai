import assert from "node:assert/strict";
import test from "node:test";

import { parseCompanyHireAction } from "@/features/company-hiring/companyHireModels";
import { prebuiltHeadForFunction } from "./prebuiltAgents.ts";
import {
  buildPrebuiltHireProposal,
  prebuiltFirstMoveText,
  prebuiltHireMarker,
} from "./prebuiltHireModels.ts";

test("a prebuilt head creates the strict relay proposal shape", () => {
  const agent = prebuiltHeadForFunction("finance");
  assert.ok(agent);
  const proposal = buildPrebuiltHireProposal({
    agent,
    choice: {
      runtimeId: "codex",
      providerId: "openai",
      modelId: "gpt-6",
      effortLevel: "high",
    },
    hireId: "00000000-0000-4000-8000-000000000001",
    introductionChannelId: "00000000-0000-4000-8000-000000000002",
    managerPubkey: "a".repeat(64),
    personaId: "persona-finance-head",
  });
  assert.deepEqual(Object.keys(proposal).sort(), [
    "displayName",
    "hireId",
    "introductionChannelId",
    "managerPubkey",
    "modelId",
    "providerId",
    "rolePack",
    "runtimeId",
    "title",
  ]);
  assert.equal(
    parseCompanyHireAction({
      schemaVersion: 1,
      hireId: proposal.hireId,
      action: "create",
      proposal,
    })?.proposal?.displayName,
    agent.name,
  );
});

test("the first move is tagged durably and still names the owner", () => {
  const agent = prebuiltHeadForFunction("sales");
  assert.ok(agent);
  assert.equal(
    prebuiltFirstMoveText(agent, "Basheer N."),
    `Hi Basheer. ${agent.firstMove}`,
  );
  assert.equal(
    prebuiltHireMarker("hire-id"),
    "company-prebuilt-hire:hire-id:first-move",
  );
});
