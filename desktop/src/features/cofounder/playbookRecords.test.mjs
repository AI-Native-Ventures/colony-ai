import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  KIND_PLAYBOOK_ACTION,
  KIND_PLAYBOOK_HEAD,
} from "@/shared/constants/kinds";
import {
  CEDAR_CAFE_JOB_ID,
  DELIVERY_PLAYBOOK_ID,
  FOLLOW_UP_PLAYBOOK_ID,
  NORTHLINE_JOB_ID,
  PLANE_TREE_JOB_ID,
  deliveryJobs,
  deliveryPlaybook,
  followUpPlaybook,
} from "../../testing/cofounderPlaybookFixtures.ts";
import {
  mockPlaybookHeadContent,
  mockPlaybookJobHeadContent,
} from "../../testing/mockCompanyPlaybooks.ts";
import { buildApprovalLog } from "./approvalLog.ts";
import { buildNeedsYou } from "./needsYou.ts";
import {
  buildPlaybookActionEvent,
  buildPlaybookJobActionEvent,
  playbookActions,
  playbookJobActions,
} from "./playbookActions.ts";
import {
  jobOpenHumanSteps,
  jobProgress,
  jobStepsWaitingForApproval,
  jobsOfPlaybook,
  lastApprovedChange,
  latestJobs,
  latestPlaybooks,
  parsePlaybookHead,
  parsePlaybookJobHead,
  playbookApprovalPointCount,
  playbookDTag,
  playbookJobDTag,
  playbookRecordKind,
} from "./playbookRecords.ts";

const SCOUT = "5".repeat(64);
const OWNER = "7".repeat(64);
const RELAY_SECRET = generateSecretKey();
const RELAY = getPublicKey(RELAY_SECRET);
const INPUT = { scoutPubkey: SCOUT, ownerPubkey: OWNER };

function sign(content, dTag, overrides = {}) {
  return finalizeEvent(
    {
      kind: KIND_PLAYBOOK_HEAD,
      content: JSON.stringify(content),
      tags: [["d", dTag]],
      created_at: 1_793_000_000,
      ...overrides,
    },
    overrides.secret ?? RELAY_SECRET,
  );
}

function playbookEvent(playbook = deliveryPlaybook(INPUT), overrides) {
  return sign(
    mockPlaybookHeadContent(playbook),
    playbookDTag(playbook.playbookId),
    overrides,
  );
}

function jobEvent(job, overrides) {
  return sign(
    mockPlaybookJobHeadContent(job),
    playbookJobDTag(job.jobId),
    overrides,
  );
}

function playbook(mock = deliveryPlaybook(INPUT)) {
  const parsed = parsePlaybookHead(playbookEvent(mock), RELAY);
  assert.ok(parsed, "playbook parses");
  return parsed;
}

function job(id) {
  const mock = deliveryJobs(INPUT).find((candidate) => candidate.jobId === id);
  assert.ok(mock, "job fixture exists");
  const parsed = parsePlaybookJobHead(jobEvent(mock), RELAY);
  assert.ok(parsed, "job parses");
  return parsed;
}

test("the delivery playbook parses with its approved version and waiting change", () => {
  const parsed = playbook();
  assert.equal(parsed.playbookId, DELIVERY_PLAYBOOK_ID);
  assert.equal(parsed.status, "active");
  assert.equal(parsed.version, 2);
  assert.equal(parsed.title, "Delivery playbook");
  assert.equal(parsed.current.steps.length, 7);
  assert.equal(parsed.current.functionId, "operations");
  assert.equal(parsed.current.steps[2].owner.workerType, "site_build");
  assert.deepEqual(parsed.current.steps[0].inputs, ["signed agreement"]);
  assert.equal(playbookApprovalPointCount(parsed.current), 2);
  assert.equal(parsed.pending.revision, 1);
  assert.match(parsed.pending.changeSummary, /logins checklist/);
  assert.equal(parsed.pending.proposedByPubkey, SCOUT);
  const last = lastApprovedChange(parsed);
  assert.equal(last.version, 2);
  assert.equal(last.actorPubkey, OWNER);
  assert.equal(parsed.eventId.length, 64);
});

test("a never approved playbook has no version and shows the proposal's title", () => {
  const parsed = playbook(followUpPlaybook(INPUT));
  assert.equal(parsed.playbookId, FOLLOW_UP_PLAYBOOK_ID);
  assert.equal(parsed.status, "proposed");
  assert.equal(parsed.version, 0);
  assert.equal(parsed.current, null);
  assert.equal(parsed.title, "Lead follow-up");
  assert.equal(lastApprovedChange(parsed), null);
});

test("running copies parse with their current step and progress", () => {
  const plane = job(PLANE_TREE_JOB_ID);
  assert.equal(plane.currentStepId, "build");
  assert.deepEqual(
    { done: jobProgress(plane).done, total: jobProgress(plane).total },
    { done: 2, total: 7 },
  );
  assert.equal(jobProgress(plane).currentStep.title, "Website build");
  assert.equal(plane.playbookVersion, 2);

  const cedar = job(CEDAR_CAFE_JOB_ID);
  assert.equal(cedar.currentStepId, "revisions");
  assert.equal(jobProgress(cedar).currentStep.progressLabel, "Round 1 of 2");
  assert.ok(
    cedar.approvals.length > 0,
    "finished approval points are on record",
  );

  const northline = job(NORTHLINE_JOB_ID);
  assert.equal(northline.currentStepId, "launch");
  assert.equal(northline.steps[6].status, "waiting_approval");
});

test("the d tag tells the two families apart", () => {
  assert.equal(
    playbookRecordKind(playbookDTag(DELIVERY_PLAYBOOK_ID)),
    "playbook",
  );
  assert.equal(playbookRecordKind(playbookJobDTag(PLANE_TREE_JOB_ID)), "job");
  assert.equal(playbookRecordKind("company:plan:x"), null);
  // A playbook head under a job d-tag (or the other way round) is refused.
  const content = mockPlaybookHeadContent(deliveryPlaybook(INPUT));
  assert.equal(
    parsePlaybookJobHead(
      sign(content, playbookJobDTag(PLANE_TREE_JOB_ID)),
      RELAY,
    ),
    null,
  );
  assert.equal(
    parsePlaybookHead(
      sign(
        mockPlaybookJobHeadContent(deliveryJobs(INPUT)[0]),
        playbookDTag(DELIVERY_PLAYBOOK_ID),
      ),
      RELAY,
    ),
    null,
  );
});

test("heads that do not come from the relay or break a rule are refused", () => {
  const good = playbookEvent();
  assert.ok(parsePlaybookHead(good, RELAY));
  assert.equal(parsePlaybookHead(good, "9".repeat(64)), null, "wrong author");
  const content = mockPlaybookHeadContent(deliveryPlaybook(INPUT));
  const dTag = playbookDTag(DELIVERY_PLAYBOOK_ID);
  assert.equal(
    parsePlaybookHead(sign({ ...content, surprise: true }, dTag), RELAY),
    null,
    "unknown key",
  );
  assert.equal(
    parsePlaybookHead(sign({ ...content, version: 0 }, dTag), RELAY),
    null,
    "a version of 0 with approved content",
  );
  const steps = content.current.steps.map((step, index) =>
    index === 2
      ? {
          ...step,
          approvalPoint: { kind: "outreach", prompt: "Approve" },
        }
      : step,
  );
  assert.equal(
    parsePlaybookHead(
      sign({ ...content, current: { ...content.current, steps } }, dTag),
      RELAY,
    ),
    null,
    "a worker step never carries an outreach approval point",
  );
  const duplicate = [content.current.steps[0], content.current.steps[0]];
  assert.equal(
    parsePlaybookHead(
      sign(
        { ...content, current: { ...content.current, steps: duplicate } },
        dTag,
      ),
      RELAY,
    ),
    null,
    "duplicate step ids",
  );
});

test("a job head that disagrees about its current step is refused", () => {
  const mock = deliveryJobs(INPUT)[0];
  const content = mockPlaybookJobHeadContent(mock);
  const dTag = playbookJobDTag(mock.jobId);
  assert.ok(parsePlaybookJobHead(sign(content, dTag), RELAY));
  assert.equal(
    parsePlaybookJobHead(
      sign({ ...content, currentStepId: "launch" }, dTag),
      RELAY,
    ),
    null,
  );
  const { currentStepId: _omitted, ...withoutCurrent } = content;
  assert.equal(
    parsePlaybookJobHead(sign(withoutCurrent, dTag), RELAY),
    null,
    "a running job names its current step",
  );
});

test("the newest head per record wins", () => {
  const older = parsePlaybookHead(playbookEvent(), RELAY);
  const moved = deliveryPlaybook(INPUT);
  moved.updatedAt = 1_793_900_000;
  moved.version = 3;
  const newer = parsePlaybookHead(
    playbookEvent(moved, { created_at: 1_793_900_000 }),
    RELAY,
  );
  const result = latestPlaybooks([
    { playbook: older, createdAt: 1_793_000_000 },
    { playbook: newer, createdAt: 1_793_900_000 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].version, 3);

  const first = job(PLANE_TREE_JOB_ID);
  const second = job(CEDAR_CAFE_JOB_ID);
  assert.equal(
    latestJobs([
      { job: first, createdAt: 1 },
      { job: first, createdAt: 2 },
      { job: second, createdAt: 1 },
    ]).length,
    2,
  );
});

test("jobs of a playbook list running copies first, newest change first", () => {
  const jobs = deliveryJobs(INPUT).map((mock) =>
    parsePlaybookJobHead(jobEvent(mock), RELAY),
  );
  const listed = jobsOfPlaybook(jobs, DELIVERY_PLAYBOOK_ID);
  assert.equal(listed.length, 3);
  assert.equal(listed[0].title, "Plane Tree Guesthouse");
  assert.equal(jobsOfPlaybook(jobs, "other").length, 0);
});

test("a step at its approval point waits for the owner, a founder step is theirs to do", () => {
  const northline = job(NORTHLINE_JOB_ID);
  assert.deepEqual(
    jobStepsWaitingForApproval(northline).map((step) => step.stepId),
    ["launch"],
  );
  assert.equal(jobOpenHumanSteps(northline).length, 0);
  // A founder step with an approval point is at that point as soon as it is current.
  const mock = deliveryJobs(INPUT)[1];
  mock.steps = mock.steps.map((step) => ({
    ...step,
    status:
      step.stepId === "approval"
        ? "pending"
        : step.stepId === "logins" ||
            step.stepId === "brief" ||
            step.stepId === "build"
          ? "done"
          : "pending",
  }));
  const atApproval = parsePlaybookJobHead(jobEvent(mock), RELAY);
  assert.equal(atApproval.currentStepId, "approval");
  assert.deepEqual(
    jobStepsWaitingForApproval(atApproval).map((step) => step.stepId),
    ["approval"],
  );
  assert.equal(jobOpenHumanSteps(atApproval).length, 0, "not also a Do item");
  // An ungated founder step is a Do item.
  mock.steps = mock.steps.map((step) => ({
    ...step,
    status: step.stepId === "brief" ? "done" : "pending",
  }));
  const atLogins = parsePlaybookJobHead(jobEvent(mock), RELAY);
  assert.equal(atLogins.currentStepId, "logins");
  assert.deepEqual(
    jobOpenHumanSteps(atLogins).map((step) => step.stepId),
    ["logins"],
  );
  assert.equal(jobStepsWaitingForApproval(atLogins).length, 0);
});

test("action events name the exact head and carry the right d tag", () => {
  const parsed = playbook();
  const approve = buildPlaybookActionEvent(
    playbookActions.approve(parsed, "ok"),
  );
  assert.deepEqual(approve.tags, [["d", playbookDTag(DELIVERY_PLAYBOOK_ID)]]);
  assert.deepEqual(JSON.parse(approve.content), {
    schemaVersion: 1,
    playbookId: DELIVERY_PLAYBOOK_ID,
    kind: "approve",
    revision: 1,
    note: "ok",
    expectedHeadEventId: parsed.eventId,
  });
  assert.equal(KIND_PLAYBOOK_ACTION, 47067);
  // No waiting change: the helper refuses instead of sending a doomed write.
  const published = { ...parsed, pending: null };
  assert.throws(
    () => playbookActions.approve(published),
    /No change is waiting/,
  );

  const propose = buildPlaybookActionEvent({
    kind: "propose",
    playbookId: DELIVERY_PLAYBOOK_ID,
    content: { title: "T", steps: [] },
  });
  assert.equal(JSON.parse(propose.content).expectedHeadEventId, undefined);
  const change = JSON.parse(
    buildPlaybookActionEvent(
      playbookActions.proposeChange(
        parsed,
        { title: "T", steps: [] },
        "Add a step",
      ),
    ).content,
  );
  assert.equal(change.kind, "propose_change");
  assert.equal(change.changeSummary, "Add a step");
  assert.equal(change.expectedHeadEventId, parsed.eventId);
});

test("job action events carry the job d tag and the exact head", () => {
  const northline = job(NORTHLINE_JOB_ID);
  const approve = buildPlaybookJobActionEvent(
    playbookJobActions.approveStep(northline, "launch"),
  );
  assert.deepEqual(approve.tags, [["d", playbookJobDTag(NORTHLINE_JOB_ID)]]);
  assert.deepEqual(JSON.parse(approve.content), {
    schemaVersion: 1,
    jobId: NORTHLINE_JOB_ID,
    kind: "approve_step",
    stepId: "launch",
    expectedHeadEventId: northline.eventId,
  });
  const start = JSON.parse(
    buildPlaybookJobActionEvent(
      playbookJobActions.start(
        playbook(),
        "dddddddd-0000-4000-8000-000000000000",
        "Acme",
      ),
    ).content,
  );
  assert.equal(start.kind, "start");
  assert.equal(start.playbookVersion, 2);
  assert.equal(start.expectedHeadEventId, undefined);
  const handOff = JSON.parse(
    buildPlaybookJobActionEvent(
      playbookJobActions.handOff(northline, "launch", {
        kind: "function",
        function: "sales",
      }),
    ).content,
  );
  assert.deepEqual(handOff.handOffTo, { kind: "function", function: "sales" });
});

test("Needs you lists playbook proposals, a step at its approval point and a founder step", () => {
  const delivery = playbook();
  const followUp = playbook(followUpPlaybook(INPUT));
  const northline = job(NORTHLINE_JOB_ID);
  const sources = {
    asks: [],
    plans: [],
    playbooks: [delivery, followUp],
    playbookJobs: [northline],
    whatsappBatches: [],
    whatsappDrafts: [],
  };
  const owner = buildNeedsYou({ ...sources, canApprove: true });
  const ids = owner.approve.map((item) => item.id).sort();
  assert.deepEqual(ids, [
    `playbook-step:${NORTHLINE_JOB_ID}:launch`,
    `playbook:${DELIVERY_PLAYBOOK_ID}`,
    `playbook:${FOLLOW_UP_PLAYBOOK_ID}`,
  ]);
  const change = owner.approve.find(
    (item) => item.id === `playbook:${DELIVERY_PLAYBOOK_ID}`,
  );
  assert.equal(change.category, "playbook");
  assert.equal(change.title, "Change to Delivery playbook");
  assert.match(change.subtitle, /logins checklist/);
  assert.equal(change.fromPubkey, SCOUT);
  assert.deepEqual(
    change.actions.map((action) => action.id),
    ["approve", "edit", "reject"],
  );
  assert.deepEqual(change.source, {
    kind: "playbook",
    playbookId: DELIVERY_PLAYBOOK_ID,
  });
  const fresh = owner.approve.find(
    (item) => item.id === `playbook:${FOLLOW_UP_PLAYBOOK_ID}`,
  );
  assert.equal(fresh.title, "New playbook: Lead follow-up");
  const step = owner.approve.find((item) =>
    item.id.startsWith("playbook-step:"),
  );
  assert.equal(step.approvalKind, "other");
  assert.match(step.subtitle, /Northline Interiors/);
  assert.deepEqual(step.source, {
    kind: "playbook_job",
    jobId: NORTHLINE_JOB_ID,
    stepId: "launch",
  });

  // Only an owner or admin sees any of it.
  const member = buildNeedsYou({ ...sources, canApprove: false });
  assert.equal(member.total, 0);
  // Sources stay optional: callers that know nothing of playbooks still work.
  const without = buildNeedsYou({
    asks: [],
    plans: [],
    whatsappBatches: [],
    whatsappDrafts: [],
    canApprove: true,
  });
  assert.equal(without.total, 0);
});

test("a decided playbook change and a step approval reach the approval log", () => {
  const delivery = playbook();
  const cedar = job(CEDAR_CAFE_JOB_ID);
  const log = buildApprovalLog({
    plans: [],
    asks: [],
    playbooks: [delivery],
    playbookJobs: [cedar],
  });
  const playbookEntries = log.filter(
    (entry) => entry.source.kind === "playbook",
  );
  assert.equal(playbookEntries.length, 2);
  assert.ok(playbookEntries.every((entry) => entry.decision === "approved"));
  assert.ok(playbookEntries.every((entry) => entry.actorPubkey === OWNER));
  assert.equal(playbookEntries[0].source.version, 2, "newest first");
  assert.match(playbookEntries[0].subject, /launch approval point/);
  const stepEntries = log.filter(
    (entry) => entry.source.kind === "playbook_job",
  );
  assert.equal(stepEntries.length, 1);
  assert.equal(stepEntries[0].source.stepId, "approval");
  assert.match(stepEntries[0].subject, /Your approval \(Cedar/);
});
