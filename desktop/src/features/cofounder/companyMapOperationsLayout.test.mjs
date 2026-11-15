import assert from "node:assert/strict";
import test from "node:test";

import { buildCompanyMapOperationsLayout } from "./companyMapOperationsLayout.ts";

const workflows = [
  {
    playbookId: "delivery",
    stepIds: [
      "brief",
      "logins",
      "build",
      "approval",
      "present",
      "revisions",
      "launch",
    ],
  },
  { playbookId: "follow-up", stepIds: ["reply", "call"] },
];

test("workflow-only Operations matches the ArmOperations positions", () => {
  const layout = buildCompanyMapOperationsLayout({
    workflows,
    openPlaybookId: null,
  });

  assert.deepEqual(
    Object.fromEntries(
      layout.parts.map(({ functionId, point }) => [functionId, point]),
    ),
    {
      sales: { x: 980, y: 212 },
      operations: { x: 420, y: 127 },
      customer_success: { x: 420, y: 339 },
      finance: { x: 980, y: 562 },
      brand: { x: 420, y: 599 },
    },
  );
  assert.deepEqual(
    layout.workflows.map(({ playbookId, point }) => ({ playbookId, point })),
    [
      { playbookId: "delivery", point: { x: 220, y: 79 } },
      { playbookId: "follow-up", point: { x: 220, y: 127 } },
    ],
  );
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 175 });
  assert.equal(
    layout.jobs.some((job) => job.functionId === "operations"),
    false,
  );
});

test("an open seven-step workflow matches ArmDelivery and WalkOps", () => {
  const layout = buildCompanyMapOperationsLayout({
    workflows,
    openPlaybookId: "delivery",
  });

  assert.deepEqual(
    layout.parts.find((part) => part.functionId === "operations")?.point,
    { x: 420, y: 197 },
  );
  assert.deepEqual(
    layout.workflows.map(({ playbookId, point }) => ({ playbookId, point })),
    [
      { playbookId: "delivery", point: { x: 220, y: 23 } },
      { playbookId: "follow-up", point: { x: 220, y: 323 } },
    ],
  );
  assert.deepEqual(
    layout.steps.map(({ stepId, point }) => ({ stepId, point })),
    [
      { stepId: "brief", point: { x: 220, y: 68 } },
      { stepId: "logins", point: { x: 220, y: 98 } },
      { stepId: "build", point: { x: 220, y: 128 } },
      { stepId: "approval", point: { x: 220, y: 158 } },
      { stepId: "present", point: { x: 220, y: 188 } },
      { stepId: "revisions", point: { x: 220, y: 218 } },
      { stepId: "launch", point: { x: 220, y: 248 } },
    ],
  );
  assert.deepEqual(layout.addStep?.point, { x: 220, y: 278 });
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 371 });
});

test("a twelve-step rail remains represented even when the board starts above the default frame", () => {
  const twelveSteps = Array.from(
    { length: 12 },
    (_, index) => `step-${index + 1}`,
  );
  const layout = buildCompanyMapOperationsLayout({
    workflows: [
      { playbookId: "delivery", stepIds: twelveSteps },
      { playbookId: "follow-up", stepIds: ["reply"] },
    ],
    openPlaybookId: "delivery",
  });

  assert.deepEqual(layout.workflows[0]?.point, { x: 220, y: -52 });
  assert.deepEqual(layout.steps[0]?.point, { x: 220, y: -7 });
  assert.deepEqual(layout.steps.at(-1)?.point, { x: 220, y: 323 });
  assert.deepEqual(layout.addStep?.point, { x: 220, y: 353 });
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 446 });
});
