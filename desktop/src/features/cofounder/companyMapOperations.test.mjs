import assert from "node:assert/strict";
import test from "node:test";

import { operationsMapWorkflows } from "./companyMapOperations.ts";

const SCOUT = "a".repeat(64);
const OWNER = "b".repeat(64);

function step({ id, owner, title, approvalPoint = null, tools = [] }) {
  return {
    stepId: id,
    title,
    detail: null,
    owner,
    inputs: [],
    outputs: [],
    tools,
    approvalPoint,
  };
}

function playbook({ id, status, content, updatedAt = 10 }) {
  return {
    playbookId: id,
    status,
    version: status === "active" ? 1 : 0,
    title: content.title,
    current: status === "active" ? content : null,
    pending:
      status === "proposed"
        ? {
            content,
            changeSummary: null,
            proposedByPubkey: SCOUT,
            proposedAt: updatedAt,
            revision: 1,
          }
        : null,
    records: [],
    createdByPubkey: SCOUT,
    createdAt: 1,
    updatedByPubkey: SCOUT,
    updatedAt,
    eventId: "c".repeat(64),
  };
}

function runningJob({ id, playbookId, steps, currentStepId, updatedAt = 20 }) {
  return {
    jobId: id,
    playbookId,
    playbookVersion: 1,
    playbookTitle: "Delivery",
    title: "Plane Tree Guesthouse",
    status: "running",
    currentStepId,
    steps,
    approvals: [],
    handoffs: [],
    startedByPubkey: SCOUT,
    startedAt: 1,
    endedAt: null,
    updatedByPubkey: SCOUT,
    updatedAt,
    eventId: "d".repeat(64),
  };
}

test("maps actual Operations playbooks, ordered steps, running copies and proposal state", () => {
  const deliveryContent = {
    title: "Delivery",
    summary: "A real Operations workflow.",
    functionId: "operations",
    steps: [
      step({
        id: "build",
        title: "Website build",
        owner: { kind: "worker", workerType: "site_build" },
      }),
      step({
        id: "approval",
        title: "Your approval",
        owner: { kind: "owner" },
        approvalPoint: { kind: "taste", prompt: "Pick a direction" },
      }),
      step({
        id: "present",
        title: "Present to client",
        owner: { kind: "function", functionId: "customer_success" },
        tools: ["WhatsApp"],
      }),
    ],
  };
  const waitingJobSteps = deliveryContent.steps.map((entry) => ({
    ...entry,
    status: entry.stepId === "approval" ? "waiting_approval" : "pending",
    note: null,
    progressLabel: null,
    statusAt: 2,
  }));
  const result = operationsMapWorkflows({
    playbooks: [
      playbook({
        id: "follow-up",
        status: "proposed",
        updatedAt: 30,
        content: {
          title: "Lead follow-up",
          summary: "Waits for an owner decision.",
          functionId: "operations",
          steps: [
            step({
              id: "reply",
              title: "Draft a reply",
              owner: { kind: "lead_agent", agentPubkey: SCOUT },
            }),
          ],
        },
      }),
      playbook({
        id: "delivery",
        status: "active",
        content: deliveryContent,
      }),
    ],
    jobs: [
      runningJob({
        id: "job-1",
        playbookId: "delivery",
        steps: waitingJobSteps,
        currentStepId: "approval",
      }),
    ],
  });

  assert.deepEqual(
    result.map((workflow) => ({
      id: workflow.playbookId,
      new: workflow.isNew,
      running: workflow.runningJobCount,
      steps: workflow.steps.map((entry) => ({
        id: entry.stepId,
        target: entry.target,
        waiting: entry.waitingForOwner,
      })),
    })),
    [
      {
        id: "delivery",
        new: false,
        running: 1,
        steps: [
          { id: "build", target: "work", waiting: false },
          { id: "approval", target: "needs-you", waiting: true },
          { id: "present", target: "client-conversation", waiting: false },
        ],
      },
      {
        id: "follow-up",
        new: true,
        running: 0,
        steps: [{ id: "reply", target: "operations", waiting: false }],
      },
    ],
  );
});

test("ignores non-Operations and ended playbooks without inventing workflow nodes", () => {
  const result = operationsMapWorkflows({
    playbooks: [
      playbook({
        id: "sales",
        status: "active",
        content: {
          title: "Sales follow-up",
          summary: "Sales.",
          functionId: "sales",
          steps: [
            step({
              id: "reply",
              title: "Reply",
              owner: { kind: "owner" },
            }),
          ],
        },
      }),
      {
        ...playbook({
          id: "retired",
          status: "active",
          content: {
            title: "Retired delivery",
            summary: "Archived.",
            functionId: "operations",
            steps: [
              step({
                id: "old-step",
                title: "Old step",
                owner: { kind: "owner" },
              }),
            ],
          },
        }),
        status: "archived",
      },
    ],
    jobs: [],
  });

  assert.deepEqual(result, []);
});
