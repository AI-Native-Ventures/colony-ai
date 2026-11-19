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
      sales: { x: 980, y: 239 },
      operations: { x: 420, y: 151 },
      customer_success: { x: 420, y: 339 },
      finance: { x: 980, y: 562 },
      brand: { x: 420, y: 575 },
    },
  );
  assert.deepEqual(
    layout.workflows.map(({ playbookId, point }) => ({ playbookId, point })),
    [
      { playbookId: "delivery", point: { x: 220, y: 103 } },
      { playbookId: "follow-up", point: { x: 220, y: 151 } },
    ],
  );
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 199 });
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
    { x: 420, y: 214 },
  );
  assert.deepEqual(
    layout.workflows.map(({ playbookId, point }) => ({ playbookId, point })),
    [
      { playbookId: "delivery", point: { x: 220, y: 40 } },
      { playbookId: "follow-up", point: { x: 220, y: 340 } },
    ],
  );
  assert.deepEqual(
    layout.steps.map(({ stepId, point }) => ({ stepId, point })),
    [
      { stepId: "brief", point: { x: 220, y: 85 } },
      { stepId: "logins", point: { x: 220, y: 115 } },
      { stepId: "build", point: { x: 220, y: 145 } },
      { stepId: "approval", point: { x: 220, y: 175 } },
      { stepId: "present", point: { x: 220, y: 205 } },
      { stepId: "revisions", point: { x: 220, y: 235 } },
      { stepId: "launch", point: { x: 220, y: 265 } },
    ],
  );
  assert.deepEqual(layout.addStep?.point, { x: 220, y: 295 });
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 388 });
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

  assert.deepEqual(layout.workflows[0]?.point, { x: 220, y: -35 });
  assert.deepEqual(layout.steps[0]?.point, { x: 220, y: 10 });
  assert.deepEqual(layout.steps.at(-1)?.point, { x: 220, y: 340 });
  assert.deepEqual(layout.addStep?.point, { x: 220, y: 370 });
  assert.deepEqual(layout.addWorkflow.point, { x: 220, y: 463 });
});
