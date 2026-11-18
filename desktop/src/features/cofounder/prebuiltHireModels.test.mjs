import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCompanyHireAction } from "@/features/company-hiring/companyHireModels";
import { buildAccessActionEvent } from "./accessRecords.ts";
import { prebuiltHeadForFunction } from "./prebuiltAgents.ts";
import {
  buildPrebuiltHireApproveAction,
  buildPrebuiltHireAttachEmployeeAction,
  buildPrebuiltHireCompleteAction,
  buildPrebuiltHireCreateAction,
  buildPrebuiltHireProposal,
  buildPrebuiltSlotHireSetAction,
  prebuiltFirstMessageText,
  prebuiltHireFirstMessageMarker,
} from "./prebuiltHireModels.ts";

const wireFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../test-fixtures/company-hire/prebuilt-head-finance.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

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

test("the owner-visible first message is tagged durably and names the owner", () => {
  const agent = prebuiltHeadForFunction("sales");
  assert.ok(agent);
  assert.equal(
    prebuiltFirstMessageText(agent, "Basheer N."),
    `Hi Basheer. ${agent.firstMessage}`,
  );
  assert.equal(
    prebuiltHireFirstMessageMarker("hire-id"),
    "company-prebuilt-hire:hire-id:first-message",
  );
});

test("the prebuilt Finance hire sends the shared relay contract", () => {
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
    hireId: wireFixture.create.hireId,
    introductionChannelId: wireFixture.create.proposal.introductionChannelId,
    managerPubkey: wireFixture.create.proposal.managerPubkey,
    personaId: wireFixture.create.proposal.rolePack.personaId,
  });

  assert.deepEqual(buildPrebuiltHireCreateAction(proposal), wireFixture.create);
  const slotHireSet = buildAccessActionEvent(
    buildPrebuiltSlotHireSetAction({
      hireId: wireFixture.create.hireId,
      functionId: "finance",
    }),
  );
  assert.deepEqual(JSON.parse(slotHireSet.content), wireFixture.slotHireSet);
  assert.deepEqual(slotHireSet.tags, [
    ["d", `company:slot-hire:${wireFixture.create.hireId}`],
  ]);
  assert.deepEqual(
    buildPrebuiltHireApproveAction({
      hireId: wireFixture.approve.hireId,
      expectedHeadEventId: wireFixture.approve.expectedHeadEventId,
    }),
    wireFixture.approve,
  );
  assert.deepEqual(
    buildPrebuiltHireAttachEmployeeAction({
      hireId: wireFixture.attachEmployee.hireId,
      expectedHeadEventId: wireFixture.attachEmployee.expectedHeadEventId,
      employeePubkey: wireFixture.attachEmployee.employeePubkey,
    }),
    wireFixture.attachEmployee,
  );
  assert.deepEqual(
    buildPrebuiltHireCompleteAction({
      hireId: wireFixture.complete.hireId,
      expectedHeadEventId: wireFixture.complete.expectedHeadEventId,
      employeePubkey: wireFixture.complete.employeePubkey,
      introductionEventId: wireFixture.complete.introductionEventId,
    }),
    wireFixture.complete,
  );
});
