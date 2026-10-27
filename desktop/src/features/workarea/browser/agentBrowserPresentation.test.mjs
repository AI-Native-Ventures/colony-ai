import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearAgentBrowserConversationView,
  decideAgentBrowserPresentation,
  isAgentBrowserTaskInView,
  isPersonActiveInWorkArea,
  noteWorkAreaPersonActivity,
  resetAgentBrowserPresentation,
  setAgentBrowserConversationView,
  WORK_AREA_PERSON_ACTIVE_MS,
} from "./agentBrowserPresentation.ts";

const CHANNEL = "12345678-1234-4234-8234-123456789abc";
const ROOT = "cd".repeat(32);
const viewOwner = {};

afterEach(() => {
  resetAgentBrowserPresentation();
  delete globalThis.document;
});

test("same visible conversation opens when the dock is closed", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: true,
      windowVisible: true,
      dockOpen: false,
      personActive: false,
      dismissedForTask: false,
    }),
    "show",
  );
});

test("same visible conversation switches an open dock when the person is inactive", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: true,
      windowVisible: true,
      dockOpen: true,
      personActive: false,
      dismissedForTask: false,
    }),
    "show",
  );
});

test("person activity in the open dock keeps the agent in the marker", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: true,
      windowVisible: true,
      dockOpen: true,
      personActive: true,
      dismissedForTask: false,
    }),
    "marker",
  );
});

test("another conversation stays in the background", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: false,
      windowVisible: true,
      dockOpen: false,
      personActive: false,
      dismissedForTask: false,
    }),
    "marker",
  );
});

test("another app or a hidden window stays in the background", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: true,
      windowVisible: false,
      dockOpen: false,
      personActive: false,
      dismissedForTask: false,
    }),
    "marker",
  );
});

test("a dock dismissed during this task stays closed for the task", () => {
  assert.equal(
    decideAgentBrowserPresentation({
      viewingX: true,
      windowVisible: true,
      dockOpen: false,
      personActive: false,
      dismissedForTask: true,
    }),
    "marker",
  );
});

test("channel and thread task visibility follow their conversation boundaries", () => {
  setAgentBrowserConversationView(viewOwner, {
    channelId: CHANNEL,
    channelType: "stream",
    threadRootId: ROOT,
  });
  assert.equal(
    isAgentBrowserTaskInView(`conversation:${CHANNEL}`, CHANNEL),
    true,
  );
  assert.equal(
    isAgentBrowserTaskInView(`thread:${CHANNEL}:${ROOT}`, CHANNEL),
    true,
  );
  assert.equal(
    isAgentBrowserTaskInView(`thread:${CHANNEL}:${"ab".repeat(32)}`, CHANNEL),
    false,
  );
  assert.equal(
    isAgentBrowserTaskInView(`conversation:${CHANNEL}`, "other"),
    false,
  );
  clearAgentBrowserConversationView(viewOwner);
  assert.equal(
    isAgentBrowserTaskInView(`conversation:${CHANNEL}`, CHANNEL),
    false,
  );
});

test("person activity is bound to the active dock tab and expires after four seconds", () => {
  noteWorkAreaPersonActivity(CHANNEL, "browser:page-1", 1_000);
  assert.equal(
    isPersonActiveInWorkArea(CHANNEL, "browser:page-1", 4_999),
    true,
  );
  assert.equal(
    isPersonActiveInWorkArea(CHANNEL, "browser:page-2", 1_001),
    false,
  );
  assert.equal(
    isPersonActiveInWorkArea(
      CHANNEL,
      "browser:page-1",
      1_000 + WORK_AREA_PERSON_ACTIVE_MS,
    ),
    false,
  );
});
