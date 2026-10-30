import type { MockPlaybook, MockPlaybookJob } from "./mockCompanyPlaybooks";

/**
 * Playbook seeds for the mock bridge, taken from the approved CFPlaybook board
 * (Horizon Labs "Delivery playbook", version 2, three running copies and one
 * proposed change). The UI lane renders these; pass them as
 * `mock.companyPlaybooks` and `mock.companyPlaybookJobs`.
 *
 * Header count: the board says "2 approval points". Those are steps 4 and 7.
 * Step 2 is a founder step with no approval point (a prepared human step, "Do").
 */
export const DELIVERY_PLAYBOOK_ID = "3c2f6a0e-1b7d-4f0a-9c55-7a1d0e4b2f11";
export const PLANE_TREE_JOB_ID = "9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4";
export const CEDAR_CAFE_JOB_ID = "5a7e2c90-3d14-4b8f-a6e1-0f9b8d7c6a52";
export const NORTHLINE_JOB_ID = "c1d8f4a3-7b26-4e90-b5a8-2e6f0d9c1b73";
/** A proposed playbook that was never approved, for the "New playbook" Needs you item. */
export const FOLLOW_UP_PLAYBOOK_ID = "e4b9a1d6-2c8f-4753-9d0a-6b1c3e5f7a82";

const DAY = 86_400;
/** 26 Oct 2026, 07:33 UTC. */
const BASE = 1_793_000_000;

type Input = { scoutPubkey: string; ownerPubkey: string };

function deliverySteps(scoutPubkey: string): MockPlaybook["current"] {
  return {
    title: "Delivery playbook",
    summary:
      "How Horizon Labs delivers a website, designed with you. Changes need your OK.",
    function: "operations",
    steps: [
      {
        stepId: "brief",
        title: "Client brief and assets",
        owner: { kind: "lead_agent", agentPubkey: scoutPubkey },
        inputs: ["signed agreement"],
        outputs: ["brief", "logo", "photos"],
        tools: ["WhatsApp", "Gmail in the browser"],
      },
      {
        stepId: "logins",
        title: "Logins and domain",
        detail: "Scout lists what is needed; you log in or share access.",
        owner: { kind: "owner" },
        tools: ["Built-in browser"],
      },
      {
        stepId: "build",
        title: "Website build",
        owner: { kind: "worker", workerType: "site_build" },
        inputs: ["brief and assets"],
        outputs: ["preview link"],
        tools: ["Site builder"],
      },
      {
        stepId: "approval",
        title: "Your approval",
        detail: "Scout brings 2 or 3 homepage options and a pick.",
        owner: { kind: "owner" },
        tools: ["Needs you"],
        approvalPoint: {
          kind: "taste",
          prompt: "Pick the design before the client sees it",
        },
      },
      {
        stepId: "present",
        title: "Present to client",
        detail: "Message drafts wait for your OK before they send.",
        owner: { kind: "function", function: "customer_success" },
        tools: ["WhatsApp"],
      },
      {
        stepId: "revisions",
        title: "Revisions",
        detail: "Up to 2 rounds. Scout reviews before the client sees it.",
        owner: { kind: "worker", workerType: "revisions" },
        tools: ["Site builder"],
      },
      {
        stepId: "launch",
        title: "Launch",
        owner: { kind: "lead_agent", agentPubkey: scoutPubkey },
        outputs: ["live site", "handover note"],
        tools: ["Domain", "hosting"],
        approvalPoint: { kind: "other", prompt: "You say go live" },
      },
    ],
  };
}

/**
 * Horizon Labs "Delivery playbook": version 2, approved by the owner on 2 Nov,
 * with one change from Scout waiting ("Add a logins checklist to step 2").
 */
export function deliveryPlaybook(input: Input): MockPlaybook {
  const current = deliverySteps(input.scoutPubkey);
  if (!current) throw new Error("delivery playbook has steps");
  const withChecklist = {
    ...current,
    steps: current.steps.map((step) =>
      step.stepId === "logins"
        ? {
            ...step,
            detail:
              "Scout lists what is needed and sends a logins checklist; you log in or share access.",
          }
        : step,
    ),
  };
  return {
    playbookId: DELIVERY_PLAYBOOK_ID,
    status: "active",
    version: 2,
    current,
    pending: {
      content: withChecklist,
      changeSummary:
        "Add a logins checklist to step 2. Two of three clients sent logins late.",
      proposedByPubkey: input.scoutPubkey,
      proposedAt: BASE + 9 * DAY,
      revision: 1,
    },
    records: [
      {
        decision: "approved",
        version: 1,
        revision: 1,
        actorPubkey: input.ownerPubkey,
        at: BASE - 6 * DAY,
        proposedByPubkey: input.scoutPubkey,
      },
      {
        decision: "approved",
        version: 2,
        revision: 1,
        actorPubkey: input.ownerPubkey,
        at: BASE + 7 * DAY,
        changeSummary: "Add a launch approval point to step 7",
        proposedByPubkey: input.scoutPubkey,
      },
    ],
    createdByPubkey: input.scoutPubkey,
    createdAt: BASE - 7 * DAY,
    updatedAt: BASE + 9 * DAY,
  };
}

function runningCopy(
  input: Input,
  job: {
    jobId: string;
    title: string;
    startedAt: number;
    doneThrough: number;
    currentStatus: "in_progress" | "waiting_approval";
    progressLabel?: string;
  },
): MockPlaybookJob {
  const steps = (deliverySteps(input.scoutPubkey)?.steps ?? []).map(
    (step, index) => {
      const status =
        index < job.doneThrough
          ? ("done" as const)
          : index === job.doneThrough
            ? job.currentStatus
            : ("pending" as const);
      return {
        ...step,
        status,
        statusAt: job.startedAt + index * DAY,
        ...(status !== "done" && status !== "pending" && job.progressLabel
          ? { progressLabel: job.progressLabel }
          : {}),
      };
    },
  );
  return {
    jobId: job.jobId,
    playbookId: DELIVERY_PLAYBOOK_ID,
    playbookVersion: 2,
    playbookTitle: "Delivery playbook",
    title: job.title,
    status: "running",
    steps,
    // Every finished step that stopped at an approval point was approved by the owner.
    approvals: steps
      .filter((step) => step.status === "done" && step.approvalPoint)
      .map((step) => ({
        stepId: step.stepId,
        decision: "approved" as const,
        actorPubkey: input.ownerPubkey,
        at: step.statusAt,
      })),
    handoffs: [],
    startedByPubkey: input.scoutPubkey,
    startedAt: job.startedAt,
    updatedAt: job.startedAt + (job.doneThrough + 1) * DAY,
  };
}

/**
 * The three running copies of the board: Plane Tree Guesthouse (step 3,
 * Website build, started 3 Nov), Cedar Cafe (step 6, Revisions, Round 1 of 2,
 * started 26 Oct) and Northline Interiors (step 7, Launch, waiting for the
 * owner, started 20 Oct).
 */
export function deliveryJobs(input: Input): MockPlaybookJob[] {
  return [
    runningCopy(input, {
      jobId: PLANE_TREE_JOB_ID,
      title: "Plane Tree Guesthouse",
      startedAt: BASE + 8 * DAY,
      doneThrough: 2,
      currentStatus: "in_progress",
    }),
    runningCopy(input, {
      jobId: CEDAR_CAFE_JOB_ID,
      title: "Cedar Café",
      startedAt: BASE,
      doneThrough: 5,
      currentStatus: "in_progress",
      progressLabel: "Round 1 of 2",
    }),
    runningCopy(input, {
      jobId: NORTHLINE_JOB_ID,
      title: "Northline Interiors",
      startedAt: BASE - 6 * DAY,
      doneThrough: 6,
      currentStatus: "waiting_approval",
    }),
  ];
}

/** A first proposal Scout made for the Sales follow-up routine, waiting for the owner. */
export function followUpPlaybook(input: Input): MockPlaybook {
  return {
    playbookId: FOLLOW_UP_PLAYBOOK_ID,
    status: "proposed",
    version: 0,
    pending: {
      content: {
        title: "Lead follow-up",
        summary: "What happens after a lead replies.",
        function: "sales",
        steps: [
          {
            stepId: "reply",
            title: "Draft a reply to the lead",
            owner: { kind: "function", function: "sales" },
            tools: ["WhatsApp"],
            approvalPoint: {
              kind: "outreach",
              prompt: "You approve every message before it sends",
            },
          },
          {
            stepId: "call",
            title: "Book a call",
            owner: { kind: "function", function: "sales" },
            tools: ["Calendar"],
          },
        ],
      },
      proposedByPubkey: input.scoutPubkey,
      proposedAt: BASE + 9 * DAY,
      revision: 1,
    },
    records: [],
    createdByPubkey: input.scoutPubkey,
    createdAt: BASE + 9 * DAY,
    updatedAt: BASE + 9 * DAY,
  };
}
