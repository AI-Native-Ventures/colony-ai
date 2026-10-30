import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_PLAYBOOK_ID,
  NORTHLINE_JOB_ID,
  deliveryJobs,
  deliveryPlaybook,
} from "./cofounderPlaybookFixtures.ts";
import {
  applyMockPlaybookAction,
  applyMockPlaybookJobAction,
} from "./mockCompanyPlaybooks.ts";

const SCOUT = "5".repeat(64);
const OWNER = "7".repeat(64);
const JOB_ID = "f0a1b2c3-d4e5-4f60-8a7b-9c8d7e6f5a4b";
const NEW_ID = "0a1b2c3d-4e5f-4a60-b7c8-d9e0f1a2b3c4";

function state() {
  return {
    companyPlaybooks: [
      deliveryPlaybook({ scoutPubkey: SCOUT, ownerPubkey: OWNER }),
    ],
    companyPlaybookJobs: deliveryJobs({
      scoutPubkey: SCOUT,
      ownerPubkey: OWNER,
    }),
  };
}

function context(overrides = {}) {
  return {
    isAdmin: true,
    cofounderEnabled: true,
    now: 1_800_000_000,
    actorPubkey: OWNER,
    eventId: "e".repeat(64),
    ...overrides,
  };
}

const base = { schemaVersion: 1 };

test("approving the waiting change moves the version and records the owner", () => {
  const mock = state();
  const refusal = applyMockPlaybookAction(
    mock,
    { ...base, playbookId: DELIVERY_PLAYBOOK_ID, kind: "approve", revision: 1 },
    context(),
  );
  assert.equal(refusal, null);
  const playbook = mock.companyPlaybooks[0];
  assert.equal(playbook.version, 3);
  assert.equal(playbook.pending, undefined);
  assert.match(playbook.current.steps[1].detail, /logins checklist/);
  const record = playbook.records.at(-1);
  assert.equal(record.decision, "approved");
  assert.equal(record.version, 3);
  assert.equal(record.actorPubkey, OWNER);
});

test("a member cannot approve, edit or archive", () => {
  for (const kind of ["approve", "reject", "edit", "archive"]) {
    const mock = state();
    const refusal = applyMockPlaybookAction(
      mock,
      {
        ...base,
        playbookId: DELIVERY_PLAYBOOK_ID,
        kind,
        revision: 1,
        content: mock.companyPlaybooks[0].current,
      },
      context({ isAdmin: false }),
    );
    assert.match(refusal, /only the owner or an admin/, kind);
    assert.equal(mock.companyPlaybooks[0].version, 2, kind);
  }
});

test("a stale revision conflicts and a rejected change leaves the version alone", () => {
  const mock = state();
  assert.match(
    applyMockPlaybookAction(
      mock,
      {
        ...base,
        playbookId: DELIVERY_PLAYBOOK_ID,
        kind: "approve",
        revision: 9,
      },
      context(),
    ),
    /^conflict: the proposal changed/,
  );
  assert.equal(
    applyMockPlaybookAction(
      mock,
      {
        ...base,
        playbookId: DELIVERY_PLAYBOOK_ID,
        kind: "reject",
        revision: 1,
      },
      context(),
    ),
    null,
  );
  assert.equal(mock.companyPlaybooks[0].version, 2);
  assert.equal(mock.companyPlaybooks[0].pending, undefined);
});

test("proposing needs the mode on and approving the first version makes it active", () => {
  const mock = state();
  const content = {
    title: "Support",
    steps: [{ stepId: "reply", title: "Reply", owner: { kind: "owner" } }],
  };
  assert.match(
    applyMockPlaybookAction(
      mock,
      { ...base, playbookId: NEW_ID, kind: "propose", content },
      context({ cofounderEnabled: false }),
    ),
    /co-founder mode is off/,
  );
  assert.equal(
    applyMockPlaybookAction(
      mock,
      { ...base, playbookId: NEW_ID, kind: "propose", content },
      context(),
    ),
    null,
  );
  const created = mock.companyPlaybooks.find((p) => p.playbookId === NEW_ID);
  assert.equal(created.status, "proposed");
  assert.equal(created.version, 0);
  assert.equal(
    applyMockPlaybookAction(
      mock,
      { ...base, playbookId: NEW_ID, kind: "approve", revision: 1 },
      context(),
    ),
    null,
  );
  assert.equal(created.status, "active");
  assert.equal(created.version, 1);
});

test("a job starts only from an approved playbook, at its version", () => {
  const mock = state();
  assert.equal(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: JOB_ID,
        kind: "start",
        playbookId: DELIVERY_PLAYBOOK_ID,
        title: "Acme",
        playbookVersion: 1,
      },
      context(),
    )?.startsWith("conflict: the playbook moved on"),
    true,
  );
  assert.equal(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: JOB_ID,
        kind: "start",
        playbookId: DELIVERY_PLAYBOOK_ID,
        title: "Acme",
        playbookVersion: 2,
      },
      context(),
    ),
    null,
  );
  const job = mock.companyPlaybookJobs.find(
    (candidate) => candidate.jobId === JOB_ID,
  );
  assert.equal(job.steps.length, 7);
  assert.ok(job.steps.every((step) => step.status === "pending"));
  assert.equal(job.startedByPubkey, OWNER);
});

test("an approval point blocks its step until the owner approves", () => {
  const mock = state();
  const job = mock.companyPlaybookJobs.find(
    (candidate) => candidate.jobId === NORTHLINE_JOB_ID,
  );
  // Northline's launch step is waiting for the owner.
  const run = {
    ...base,
    jobId: NORTHLINE_JOB_ID,
    kind: "update_step",
    stepId: "launch",
    stepStatus: "in_progress",
  };
  assert.match(
    applyMockPlaybookJobAction(mock, run, context()),
    /waits for the owner's approval/,
  );
  // A member cannot approve it.
  assert.match(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: NORTHLINE_JOB_ID,
        kind: "approve_step",
        stepId: "launch",
      },
      context({ isAdmin: false, actorPubkey: SCOUT }),
    ),
    /only the owner or an admin can approve a step/,
  );
  assert.equal(job.steps[6].status, "waiting_approval");
  assert.equal(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: NORTHLINE_JOB_ID,
        kind: "approve_step",
        stepId: "launch",
      },
      context(),
    ),
    null,
  );
  assert.equal(job.steps[6].status, "approved");
  assert.equal(job.approvals.at(-1).decision, "approved");
  assert.equal(applyMockPlaybookJobAction(mock, run, context()), null);
  assert.equal(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: NORTHLINE_JOB_ID,
        kind: "update_step",
        stepId: "launch",
        stepStatus: "done",
      },
      context(),
    ),
    null,
  );
  assert.equal(job.status, "completed");
});

test("steps run in order and a hand-off keeps the worker rule", () => {
  const mock = state();
  // A step gated for outreach cannot be handed to a worker.
  mock.companyPlaybookJobs[2].steps[6].approvalPoint = {
    kind: "outreach",
    prompt: "You approve each message",
  };
  assert.match(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: NORTHLINE_JOB_ID,
        kind: "hand_off",
        stepId: "launch",
        handOffTo: { kind: "worker", workerType: "research" },
      },
      context(),
    ),
    /workers never take outward actions/,
  );
  assert.equal(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: NORTHLINE_JOB_ID,
        kind: "hand_off",
        stepId: "launch",
        handOffTo: { kind: "function", function: "sales" },
      },
      context(),
    ),
    null,
  );
  const plane = mock.companyPlaybookJobs[0];
  assert.match(
    applyMockPlaybookJobAction(
      mock,
      {
        ...base,
        jobId: plane.jobId,
        kind: "update_step",
        stepId: "launch",
        stepStatus: "in_progress",
      },
      context(),
    ),
    /not the current step/,
  );
});
