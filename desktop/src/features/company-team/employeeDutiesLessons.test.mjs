import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  decodeEmployeeRecordHead,
  parseDutyHead,
  parseLessonHead,
  validateReadableDutySchedule,
} from "./employeeDutiesLessons.ts";
import { KIND_DUTY_HEAD, KIND_LESSON_HEAD } from "@/shared/constants/kinds";

const RELAY_SECRET = new Uint8Array(32).fill(12);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const EMPLOYEE = "2".repeat(64);
const DUTY_ID = "9d55771d-6404-4f92-9c6b-4ff59aa12260";
const LESSON_ID = "9d55771d-6404-4f92-9c6b-4ff59aa12261";
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const SOURCE_ASK_ID = "7d2d873b-f5a6-4b95-bb2f-2ac0ae2f74f8";
const NOW = "2026-09-30T05:00:00Z";

function dutyHead(employeePubkey = EMPLOYEE) {
  return {
    schemaVersion: 1,
    dutyId: DUTY_ID,
    proposal: {
      schemaVersion: 1,
      dutyId: DUTY_ID,
      employeePubkey,
      title: "Review the weekly content calendar",
      scheduleText: "Every Monday at 08:00",
      scheduleCron: "0 8 * * 1",
      timeZone: "Africa/Johannesburg",
      channelId: CHANNEL_ID,
      instructions: "Review the calendar and flag exceptions.",
    },
    status: "active",
    proposedByPubkey: "1".repeat(64),
    approvedByPubkey: "1".repeat(64),
    approvedAt: NOW,
    sourceAskId: SOURCE_ASK_ID,
    sourceAskChannelId: CHANNEL_ID,
    workflowDefinitionHash: "c".repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    sourceActionEventId: "d".repeat(64),
  };
}

function lessonHead(employeePubkey = EMPLOYEE) {
  return {
    schemaVersion: 1,
    lessonId: LESSON_ID,
    snapshot: {
      schemaVersion: 1,
      lessonId: LESSON_ID,
      employeePubkey,
      lesson: "Keep campaign conclusions linked to their sources.",
      evidence: [{ eventId: "e".repeat(64) }],
      confidence: "unassessed",
    },
    status: "candidate",
    proposedByPubkey: "1".repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    sourceActionEventId: "f".repeat(64),
  };
}

function signedHead(
  kind,
  dTag,
  head,
  employeePubkey = EMPLOYEE,
  extraTags = [],
) {
  return finalizeEvent(
    {
      kind,
      created_at: 1_790_000_000,
      content: JSON.stringify(head),
      tags: [["d", dTag], ["p", employeePubkey], ...extraTags],
    },
    RELAY_SECRET,
  );
}

function decodeDuty(event, expectedId = DUTY_ID, employeePubkey = EMPLOYEE) {
  return decodeEmployeeRecordHead({
    event,
    kind: KIND_DUTY_HEAD,
    dTag: `company:duty:${expectedId}`,
    employeePubkey,
    relaySelf: RELAY_PUBKEY,
    parseHead: parseDutyHead,
    getId: (head) => head.dutyId,
    expectedId,
    getEmployeePubkey: (head) => head.proposal.employeePubkey,
  });
}

test("employee duty read accepts a verified relay head for its tagged owner", () => {
  const parsed = decodeDuty(
    signedHead(KIND_DUTY_HEAD, `company:duty:${DUTY_ID}`, dutyHead()),
  );
  assert.equal(parsed.dutyId, DUTY_ID);
  assert.equal(parsed.proposal.employeePubkey, EMPLOYEE);
  assert.equal(parsed.proposal.scheduleCron, "0 8 * * 1");
});

test("employee duty read rejects a wrong signer, head identity, or owner", () => {
  const event = signedHead(
    KIND_DUTY_HEAD,
    `company:duty:${DUTY_ID}`,
    dutyHead(),
  );
  assert.throws(() =>
    decodeEmployeeRecordHead({
      event,
      kind: KIND_DUTY_HEAD,
      dTag: `company:duty:${DUTY_ID}`,
      employeePubkey: EMPLOYEE,
      relaySelf: "f".repeat(64),
      parseHead: parseDutyHead,
      getId: (head) => head.dutyId,
      expectedId: DUTY_ID,
      getEmployeePubkey: (head) => head.proposal.employeePubkey,
    }),
  );
  assert.throws(() => decodeDuty(event, LESSON_ID), /tags do not match/);
  assert.throws(
    () =>
      decodeDuty(
        signedHead(
          KIND_DUTY_HEAD,
          `company:duty:${DUTY_ID}`,
          dutyHead("4".repeat(64)),
        ),
      ),
    /mismatched identity/,
  );
});

test("employee duty read rejects channel-scoped heads and mismatched schedules", () => {
  const scopedEvent = signedHead(
    KIND_DUTY_HEAD,
    `company:duty:${DUTY_ID}`,
    dutyHead(),
    EMPLOYEE,
    [["h", CHANNEL_ID]],
  );
  assert.throws(() => decodeDuty(scopedEvent), /tags do not match/);

  assert.throws(
    () =>
      parseDutyHead({
        ...dutyHead(),
        proposal: { ...dutyHead().proposal, scheduleCron: "0 9 * * 1" },
      }),
    /mismatched duty schedule/,
  );
});

test("employee lesson read validates candidate evidence and record ownership", () => {
  const head = parseLessonHead(lessonHead());
  assert.equal(head.status, "candidate");
  assert.equal(head.snapshot.evidence.length, 1);
  assert.equal(head.snapshot.confidence, "unassessed");

  const event = signedHead(
    KIND_LESSON_HEAD,
    `company:lesson:${LESSON_ID}`,
    lessonHead(),
  );
  const parsed = decodeEmployeeRecordHead({
    event,
    kind: KIND_LESSON_HEAD,
    dTag: `company:lesson:${LESSON_ID}`,
    employeePubkey: EMPLOYEE,
    relaySelf: RELAY_PUBKEY,
    parseHead: parseLessonHead,
    getId: (record) => record.lessonId,
    expectedId: LESSON_ID,
    getEmployeePubkey: (record) => record.snapshot.employeePubkey,
  });
  assert.equal(parsed.lessonId, LESSON_ID);

  assert.throws(
    () =>
      parseLessonHead({
        ...lessonHead(),
        snapshot: { ...lessonHead().snapshot, evidence: [] },
      }),
    /invalid lesson snapshot/,
  );
});

test("readable duty schedules are converted with the frozen cron mapping", () => {
  assert.equal(
    validateReadableDutySchedule("Every day at 08:30"),
    "30 8 * * *",
  );
  assert.equal(
    validateReadableDutySchedule("Every Monday at 08:00"),
    "0 8 * * 1",
  );
  assert.equal(
    validateReadableDutySchedule("Every month on day 15 at 08:00"),
    "0 8 15 * *",
  );
  assert.equal(validateReadableDutySchedule("Every Monday at 25:00"), null);
});
