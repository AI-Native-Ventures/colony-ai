import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { readHireDraft, removeHireDraft, writeHireDraft } from "./hireDraft.ts";

const RELAY_URL = "ws://relay.test";
const HIRE_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const HIRE_HEAD_ID = "a".repeat(64);
const EMPLOYEE_PUBKEY = "b".repeat(64);

function proposal() {
  return {
    hireId: HIRE_ID,
    rolePack: {
      personaId: "researcher",
      title: "Hospitality researcher",
      job: "Research hospitality accounts.",
      skills: ["Research"],
      tools: [{ name: "Web search", risk: "low" }],
      workerMenu: ["buzz-agent"],
    },
    displayName: "Mina",
    title: "Hospitality researcher",
    introductionChannelId: "c1d4ba1a-e078-42ef-b896-00be34a94f11",
    runtimeId: "buzz-agent",
    providerId: "openai",
    modelId: "gpt-5.5",
    weeklyAllowance: "8.00",
  };
}

let storage;

beforeEach(() => {
  const values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  delete globalThis.sessionStorage;
});

test("hire draft keeps configured values and the attached employee across reload reads", () => {
  const draft = {
    proposal: proposal(),
    employeePubkey: EMPLOYEE_PUBKEY,
    baseHeadEventId: HIRE_HEAD_ID,
  };

  assert.equal(writeHireDraft(RELAY_URL, draft), true);
  assert.deepEqual(readHireDraft(RELAY_URL, HIRE_ID), draft);
  removeHireDraft(RELAY_URL, HIRE_ID);
  assert.equal(readHireDraft(RELAY_URL, HIRE_ID), null);
});

test("hire draft rejects malformed proposals and removes the stored value", () => {
  const key = `company-hire:${RELAY_URL}:${HIRE_ID}`;
  storage.setItem(key, JSON.stringify({ proposal: { hireId: HIRE_ID } }));

  assert.equal(readHireDraft(RELAY_URL, HIRE_ID), null);
  assert.equal(storage.getItem(key), null);
});
