import assert from "node:assert/strict";
import test from "node:test";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  STEPS,
  businessProfile,
  clockIn,
  completeRows,
  createChannel,
  dutyTime,
  employeeMessages,
  employeesForHire,
  hellos,
  hireAction,
  hireProposal,
  journalEntry,
  profileAction,
  row,
  verdictOf,
} from "./steps.mjs";

const EMPLOYEE = "ab".repeat(32);
const RELAY_SELF = "cd".repeat(32);
const CHANNEL = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const HIRE = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const MARKER = `company-hire:${HIRE}:introduction`;

const persona = {
  id: "builtin:test-employee",
  display_name: "Test Employee",
  company_role: {
    job: "Post one short note",
    skills: [],
    tools: [],
    workerMenu: ["claude"],
    duties: [
      {
        title: "Daily note",
        scheduleText: "Every day at 14:35",
        instructions: "Post one short note.",
      },
    ],
  },
};

const message = (overrides) => ({
  kind: 9,
  pubkey: EMPLOYEE,
  created_at: 1_000,
  tags: [["h", CHANNEL]],
  content: "Ready.",
  ...overrides,
});

test("the verdict is PASS only when every step passed", () => {
  const all = STEPS.map((step) => row(step.id, PASS, "seen", 1));
  assert.equal(verdictOf(all), "PASS");
  assert.equal(
    verdictOf([...all.slice(1), row(STEPS[0].id, FAIL, "x", 1)]),
    "FAIL",
  );
  const partial = completeRows(all.slice(0, 3));
  assert.equal(partial.length, STEPS.length);
  assert.equal(partial[5].status, NOT_OBSERVED);
  assert.equal(verdictOf(partial), "INCOMPLETE");
});

test("the hire proposal carries the host's role pack", () => {
  const proposal = hireProposal({
    hireId: HIRE,
    persona,
    displayName: "Gate Tester",
    channelId: CHANNEL,
    runtimeId: "claude",
  });
  assert.equal(proposal.rolePack.personaId, "builtin:test-employee");
  assert.equal(proposal.rolePack.title, "Test Employee");
  assert.equal(proposal.rolePack.duties[0].scheduleText, "Every day at 14:35");
  assert.equal(proposal.introductionChannelId, CHANNEL);
  assert.throws(() =>
    hireProposal({
      hireId: HIRE,
      persona: { id: "x" },
      displayName: "y",
      channelId: CHANNEL,
      runtimeId: "claude",
    }),
  );
});

test("record actions use the contract kinds and coordinates", () => {
  const profile = profileAction(businessProfile("Africa/Johannesburg"));
  assert.equal(profile.kind, 47046);
  assert.deepEqual(profile.tags, [["d", "business-profile"]]);
  const body = JSON.parse(profile.content);
  assert.equal(body.expectedRevision, null);
  assert.equal(body.profile.timeZone, "Africa/Johannesburg");
  assert.equal(body.profile.schemaVersion, 1);

  const hire = hireAction({
    hireId: HIRE,
    action: "approve",
    expectedHeadEventId: "e".repeat(64),
  });
  assert.equal(hire.kind, 47039);
  assert.deepEqual(hire.tags, [["d", `company:hire:${HIRE}`]]);
  assert.equal(JSON.parse(hire.content).schemaVersion, 1);

  const channel = createChannel(CHANNEL, "gate-one");
  assert.equal(channel.kind, 9007);
  assert.deepEqual(channel.tags[0], ["h", CHANNEL]);
});

test("the routine time is a whole minute in the company time zone", () => {
  const noonUtc = Date.UTC(2026, 9, 11, 12, 0, 30);
  assert.equal(clockIn(noonUtc, "Africa/Johannesburg"), "14:00");
  const duty = dutyTime(noonUtc, 35, "Africa/Johannesburg");
  assert.equal(duty.atMs % 60_000, 0);
  assert.equal(duty.clock, "14:36");
});

test("employee messages leave out the hello, other channels, other authors and older posts", () => {
  const events = [
    message({ content: "Ready." }),
    message({
      tags: [
        ["h", CHANNEL],
        ["client", MARKER],
      ],
      content: "Hi everyone",
    }),
    message({ tags: [["h", "other"]] }),
    message({ pubkey: RELAY_SELF }),
    message({ created_at: 10 }),
  ];
  const found = employeeMessages(events, {
    employee: EMPLOYEE,
    channelId: CHANNEL,
    sinceSec: 500,
    helloMarker: MARKER,
  });
  assert.deepEqual(
    found.map((event) => event.content),
    ["Ready."],
  );
  assert.equal(hellos(events, MARKER).length, 1);
});

test("a hire's employees are counted from the agent store and its journal entry is found", () => {
  const store = [
    { pubkey: EMPLOYEE, role_context: { goalId: HIRE } },
    { pubkey: RELAY_SELF, role_context: { goalId: "another" } },
    { pubkey: "", role_context: { goalId: HIRE } },
  ];
  assert.equal(employeesForHire(store, HIRE).length, 1);
  assert.equal(employeesForHire(null, HIRE).length, 0);
  const journal = { entries: [{ hireId: HIRE, step: "employee_created" }] };
  assert.equal(journalEntry(journal, HIRE)?.step, "employee_created");
  assert.equal(journalEntry(null, HIRE), null);
});

test("only persisted Complete actions for the interrupted hire count as proof", async () => {
  const { completes } = await import("./steps.mjs");
  const action = (body) => ({
    kind: 47039,
    tags: [["d", `company:hire:${HIRE}`]],
    content: JSON.stringify(body),
  });
  const complete = action({ hireId: HIRE, action: "complete" });
  assert.equal(
    completes(
      [
        complete,
        action({ hireId: HIRE, action: "approve" }),
        action({ hireId: "other", action: "complete" }),
      ],
      HIRE,
    ).length,
    1,
  );
  assert.equal(completes([complete, complete], HIRE).length, 2);
});
