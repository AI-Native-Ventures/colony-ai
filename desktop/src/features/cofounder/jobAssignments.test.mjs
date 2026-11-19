import assert from "node:assert/strict";
import test from "node:test";

import { hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  KIND_COMPANY_FUNCTION_HEAD,
  parseCompanyFunctionHead,
} from "./cofounderRecords.ts";
import {
  KIND_COMPANY_JOB_HEAD,
  buildCompanyJobActionEvent,
  companyJobDTag,
  companyJobHireDTag,
  parseCompanyJobHead,
  parseCompanyJobHeads,
  parseCompanyJobHireIntent,
} from "./jobAssignments.ts";

const SECRET = hexToBytes("1".repeat(64));
const RELAY = getPublicKey(SECRET);

function signedHead(kind, dTag, content) {
  return finalizeEvent(
    {
      kind,
      created_at: 1_795_000_000,
      tags: [["d", dTag]],
      content: JSON.stringify(content),
    },
    SECRET,
  );
}

test("job coordinates use stable ids and pending hires use their own coordinate", () => {
  assert.equal(
    companyJobDTag("sales", "follow-ups"),
    "company:job:sales:follow-ups",
  );
  assert.equal(
    companyJobHireDTag("00000000-0000-4000-8000-000000000021"),
    "company:job-hire:00000000-0000-4000-8000-000000000021",
  );
  assert.throws(() => companyJobDTag("sales", "Follow ups"));
});

test("new job heads are strict and do not disturb the old function parser", () => {
  const jobHead = signedHead(
    KIND_COMPANY_JOB_HEAD,
    "company:job:sales:follow-ups",
    {
      schemaVersion: 1,
      function: "sales",
      jobId: "follow-ups",
      state: "filled",
      assigneePubkey: "a".repeat(64),
      updatedByPubkey: "b".repeat(64),
      updatedAt: 1_795_000_000,
    },
  );
  assert.deepEqual(parseCompanyJobHead(jobHead, RELAY), {
    functionId: "sales",
    jobId: "follow-ups",
    state: "filled",
    assigneePubkey: "a".repeat(64),
    updatedByPubkey: "b".repeat(64),
    updatedAt: 1_795_000_000,
    eventId: jobHead.id,
  });
  assert.equal(parseCompanyFunctionHead(jobHead, RELAY), null);

  const oldFunctionHead = signedHead(
    KIND_COMPANY_FUNCTION_HEAD,
    "company:function:sales",
    {
      schemaVersion: 1,
      function: "sales",
      state: "filled",
      leadPubkey: "a".repeat(64),
      updatedByPubkey: "b".repeat(64),
      updatedAt: 1_795_000_000,
    },
  );
  assert.equal(parseCompanyJobHead(oldFunctionHead, RELAY), null);

  const malformed = signedHead(
    KIND_COMPANY_JOB_HEAD,
    "company:job:sales:follow-ups",
    {
      schemaVersion: 1,
      function: "sales",
      jobId: "follow-ups",
      state: "empty",
      updatedByPubkey: "b".repeat(64),
      updatedAt: 1_795_000_000,
      unexpected: true,
    },
  );
  assert.equal(parseCompanyJobHead(malformed, RELAY), null);
});

test("pending job intents stay separate from current assignment heads", () => {
  const intent = signedHead(
    KIND_COMPANY_JOB_HEAD,
    "company:job-hire:00000000-0000-4000-8000-000000000021",
    {
      schemaVersion: 1,
      hireId: "00000000-0000-4000-8000-000000000021",
      function: "sales",
      jobId: "follow-ups",
      setByPubkey: "b".repeat(64),
      updatedAt: 1_795_000_000,
    },
  );
  assert.deepEqual(parseCompanyJobHireIntent(intent, RELAY), {
    hireId: "00000000-0000-4000-8000-000000000021",
    functionId: "sales",
    jobId: "follow-ups",
    eventId: intent.id,
  });
  assert.equal(parseCompanyJobHead(intent, RELAY), null);
});

test("a relay without job records leaves every job on its existing fallback", () => {
  assert.deepEqual(parseCompanyJobHeads([], RELAY), []);
});

test("job action builders bind their content to the relay coordinate", () => {
  const wire = buildCompanyJobActionEvent({
    action: "assign",
    functionId: "sales",
    jobId: "follow-ups",
    assigneePubkey: "a".repeat(64),
    expectedHeadEventId: null,
  });
  assert.deepEqual(JSON.parse(wire.content), {
    schemaVersion: 1,
    action: "assign",
    function: "sales",
    jobId: "follow-ups",
    assigneePubkey: "a".repeat(64),
  });
  assert.deepEqual(wire.tags, [["d", "company:job:sales:follow-ups"]]);
});
