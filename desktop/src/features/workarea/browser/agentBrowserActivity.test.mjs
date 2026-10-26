import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import {
  BROWSER_ACTIVITY_MS,
  BROWSER_QUESTION_MS,
  answerBrowserContinue,
  askBrowserContinue,
  channelOfTask,
  getBrowserActivityForChannel,
  getBrowserActivityForHost,
  noteBrowserEvent,
  noteBrowserGrant,
  resetBrowserActivity,
  setBrowserActivityClockForTests,
  subscribeBrowserActivity,
} from "./agentBrowserActivity.ts";

const SCOUT = "a".repeat(64);
const SAGE = "b".repeat(64);
const CHANNEL = "12345678-1234-4234-8234-123456789abc";
const OTHER = "99999999-1234-4234-8234-123456789abc";
let now = 0;

const act = (agentId, channel, tabId, extra = {}) =>
  noteBrowserEvent({
    type: "agent-action",
    entry: {
      seq: 1,
      ts: now,
      agentId,
      taskId: `conversation:${channel}`,
      tabId,
      tool: "browser_click",
      status: "ok",
      ...extra,
    },
  });

beforeEach(() => {
  now = 1_000;
  mock.timers.enable({ apis: ["setTimeout"] });
  setBrowserActivityClockForTests(() => now);
  resetBrowserActivity();
});

afterEach(() => {
  resetBrowserActivity();
  mock.timers.reset();
});

const tick = (ms) => {
  now += ms;
  mock.timers.tick(ms);
};

test("a task id names its channel; anything else names none", () => {
  assert.equal(channelOfTask(`conversation:${CHANNEL}`), CHANNEL);
  assert.equal(channelOfTask(`conversation:${CHANNEL.toUpperCase()}`), null);
  assert.equal(channelOfTask(`thread:${CHANNEL}:${"cd".repeat(32)}`), CHANNEL);
  assert.equal(channelOfTask("conversation:not-a-channel"), null);
  assert.equal(channelOfTask(undefined), null);
});

test("an agent that just acted is using the browser, in its channel and on the tab it touched, until it goes quiet", () => {
  act(SCOUT, CHANNEL, "host-1");
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), [
    {
      agentId: SCOUT,
      channelId: CHANNEL,
      state: "working",
      hostIds: ["host-1"],
    },
  ]);
  assert.equal(getBrowserActivityForHost("host-1").length, 1);
  assert.equal(getBrowserActivityForHost("host-2").length, 0);
  assert.deepEqual(getBrowserActivityForChannel(OTHER), []);
  tick(BROWSER_ACTIVITY_MS - 1);
  assert.equal(getBrowserActivityForChannel(CHANNEL).length, 1);
  tick(1);
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
  assert.deepEqual(getBrowserActivityForHost("host-1"), []);
});

test("each action renews the time, and the tabs it touched add up", () => {
  act(SCOUT, CHANNEL, "host-1");
  tick(BROWSER_ACTIVITY_MS - 100);
  act(SCOUT, CHANNEL, "host-2");
  tick(BROWSER_ACTIVITY_MS - 100);
  const [item] = getBrowserActivityForChannel(CHANNEL);
  assert.deepEqual(item.hostIds, ["host-1", "host-2"]);
  tick(200);
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("two agents in one channel and one agent in two channels are told apart", () => {
  act(SCOUT, CHANNEL, "host-1");
  act(SAGE, CHANNEL, "host-2");
  act(SCOUT, OTHER, "host-3");
  assert.deepEqual(
    getBrowserActivityForChannel(CHANNEL).map((item) => item.agentId),
    [SCOUT, SAGE],
  );
  assert.deepEqual(
    getBrowserActivityForChannel(OTHER).map((item) => item.agentId),
    [SCOUT],
  );
  assert.deepEqual(
    getBrowserActivityForHost("host-3").map((item) => item.channelId),
    [OTHER],
  );
});

test("actions with no agent or no channel are ignored", () => {
  noteBrowserEvent({
    type: "agent-action",
    entry: { seq: 1, ts: 1, tool: "browser_click", status: "ok" },
  });
  act(SCOUT, "not-a-channel", "host-1");
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("an agent stopped on a question needs the person until it is answered, and that wins over working", () => {
  noteBrowserGrant({
    id: "grant-1",
    agentId: SCOUT,
    taskId: `conversation:${CHANNEL}`,
  });
  act(SCOUT, CHANNEL, "host-1");
  noteBrowserEvent({
    type: "confirmation-requested",
    actionId: "action-1",
    grantId: "grant-1",
    tabId: "host-1",
    summary: "Send",
  });
  assert.equal(getBrowserActivityForChannel(CHANNEL)[0].state, "needs-you");
  tick(BROWSER_ACTIVITY_MS + 1);
  assert.equal(getBrowserActivityForChannel(CHANNEL)[0].state, "needs-you");
  noteBrowserEvent({
    type: "confirmation-resolved",
    actionId: "action-1",
    grantId: "grant-1",
    outcome: "approved",
  });
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("a site waiting for the person is a question until the site is approved or the grant ends", () => {
  noteBrowserGrant({
    id: "grant-1",
    agentId: SCOUT,
    taskId: `conversation:${CHANNEL}`,
  });
  const ask = () =>
    noteBrowserEvent({
      type: "origin-approval-requested",
      grantId: "grant-1",
      tabId: "host-1",
      origin: "https://other.example",
      url: "https://other.example/",
    });
  ask();
  assert.equal(getBrowserActivityForChannel(CHANNEL)[0].state, "needs-you");
  noteBrowserEvent({
    type: "grant-changed",
    grantId: "grant-1",
    state: "active",
    change: "origin-approved",
  });
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
  ask();
  noteBrowserEvent({
    type: "grant-changed",
    grantId: "grant-1",
    state: "revoked",
  });
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
  // A grant the app never made is not ours to speak for.
  noteBrowserEvent({
    type: "origin-approval-requested",
    grantId: "someone-else",
    tabId: "host-9",
    origin: "https://x.example",
    url: "https://x.example/",
  });
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("an agent waiting to continue after Stop needs the person until Allow or Not now", () => {
  askBrowserContinue(SCOUT, CHANNEL, "host-1");
  assert.equal(getBrowserActivityForChannel(CHANNEL)[0].state, "needs-you");
  assert.equal(getBrowserActivityForHost("host-1").length, 1);
  answerBrowserContinue(SCOUT, "host-1");
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("a question nobody answers stops showing after a while", () => {
  askBrowserContinue(SCOUT, CHANNEL, "host-1");
  tick(BROWSER_QUESTION_MS - 1);
  assert.equal(getBrowserActivityForChannel(CHANNEL).length, 1);
  tick(1);
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});

test("snapshots are stable between changes and subscribers hear each change once", () => {
  let heard = 0;
  const off = subscribeBrowserActivity(() => {
    heard += 1;
  });
  act(SCOUT, CHANNEL, "host-1");
  const first = getBrowserActivityForChannel(CHANNEL);
  assert.equal(getBrowserActivityForChannel(CHANNEL), first);
  assert.equal(heard, 1);
  tick(BROWSER_ACTIVITY_MS);
  assert.equal(heard, 2);
  off();
  act(SCOUT, CHANNEL, "host-1");
  assert.equal(heard, 2);
});

test("resetting drops everything and its timers", () => {
  act(SCOUT, CHANNEL, "host-1");
  askBrowserContinue(SAGE, CHANNEL, "host-2");
  resetBrowserActivity();
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
  tick(BROWSER_QUESTION_MS * 2);
  assert.deepEqual(getBrowserActivityForChannel(CHANNEL), []);
});
