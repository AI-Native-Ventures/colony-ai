import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCompanyHireAction } from "@/features/company-hiring/companyHireModels";
import { buildAccessActionEvent } from "./accessRecords.ts";
import {
  prebuiltBuiltInRole,
  prebuiltHeadForFunction,
  materializePrebuiltAgent,
  PREBUILT_AGENTS,
} from "./prebuiltAgents.ts";
import {
  buildPrebuiltHireApproveAction,
  buildPrebuiltHireAttachEmployeeAction,
  buildPrebuiltHireCompleteAction,
  buildPrebuiltHireCreateAction,
  buildPrebuiltHireDenyAction,
  buildPrebuiltHireProposal,
  buildPrebuiltSlotHireSetAction,
  prebuiltFirstMessageText,
  prebuiltHireIntroductionMarker,
  prebuiltHireFirstMessageMarker,
  prebuiltIntroductionText,
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
  assert.equal(proposal.rolePack.job, "Head of Finance");
});

test("prebuilt head role-pack jobs keep their approved display names", () => {
  for (const [functionId, expectedJob] of [
    ["finance", "Head of Finance"],
    ["customer_success", "Head of Customer Success"],
  ]) {
    const agent = prebuiltHeadForFunction(functionId);
    assert.ok(agent);
    assert.equal(
      prebuiltBuiltInRole(agent, "codex").companyRole.job,
      expectedJob,
    );
    assert.equal(
      buildPrebuiltHireProposal({
        agent,
        choice: {
          runtimeId: "codex",
          providerId: "openai",
          modelId: "gpt-6",
        },
        hireId: "00000000-0000-4000-8000-000000000011",
        introductionChannelId: "00000000-0000-4000-8000-000000000012",
        managerPubkey: "b".repeat(64),
        personaId: `persona-${functionId}-head`,
      }).rolePack.job,
      expectedJob,
    );
  }
});

test("a reopened Operations hire reuses its existing persona before creating an agent", async () => {
  const agent = prebuiltHeadForFunction("operations");
  assert.ok(agent);
  const role = prebuiltBuiltInRole(agent, "goose");
  let createCalls = 0;
  const personaId = await materializePrebuiltAgent(agent, "goose", {
    scope: "operations-reopen",
    listPersonas: async () => [
      {
        id: "persona-operations-head",
        displayName: role.displayName,
        avatarUrl: null,
        description: role.description,
        companyRole: role.companyRole,
        systemPrompt: role.systemPrompt,
        runtime: null,
        model: null,
        provider: null,
        namePool: [],
        isBuiltIn: false,
        isActive: true,
        shared: false,
        envVars: {},
        respondTo: null,
        respondToAllowlist: [],
        parallelism: null,
        createdAt: "2026-11-22T04:20:01.000Z",
        updatedAt: "2026-11-22T04:20:01.000Z",
      },
    ],
    createPersona: async () => {
      createCalls += 1;
      throw new Error("an existing Operations persona must be reused");
    },
  });

  assert.equal(personaId, "persona-operations-head");
  assert.equal(createCalls, 0);
});

test("the channel introduction and owner-visible first message use distinct durable markers", () => {
  const agent = prebuiltHeadForFunction("sales");
  assert.ok(agent);
  const specialist = PREBUILT_AGENTS.find(
    (candidate) => candidate.id === "prebuilt-invoices",
  );
  assert.ok(specialist);
  assert.equal(
    prebuiltIntroductionText(agent, "Basheer N."),
    "Head of Sales here. I have joined to lead Sales. Basheer, I sent you a message to get started.",
  );
  assert.equal(
    prebuiltIntroductionText(specialist, "Basheer N."),
    "Invoices specialist here. I have joined to do Invoices in Finance. Basheer, I sent you a message to get started.",
  );
  assert.equal(
    prebuiltFirstMessageText(agent, "Basheer N."),
    `Hi Basheer. ${agent.firstMessage}`,
  );
  assert.equal(
    prebuiltHireIntroductionMarker("hire-id"),
    "company-prebuilt-hire:hire-id:introduction",
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

  assert.equal(proposal.rolePack.job, "Head of Finance");
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
    buildPrebuiltHireDenyAction({
      hireId: wireFixture.deny.hireId,
      expectedHeadEventId: wireFixture.deny.expectedHeadEventId,
      reason: wireFixture.deny.reason,
    }),
    wireFixture.deny,
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
