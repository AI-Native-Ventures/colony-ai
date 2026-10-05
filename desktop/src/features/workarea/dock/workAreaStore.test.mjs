import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  closeWorkArea,
  closeWorkAreaTab,
  getWorkAreaPersistDirtyForTests,
  getWorkAreaState,
  initWorkAreaStore,
  openWorkArea,
  parseWorkAreaSnapshot,
  resetWorkAreaStore,
  resetWorkAreaWidth,
  selectWorkAreaTab,
  setWorkAreaClockForTests,
  setWorkAreaWidth,
  subscribeWorkArea,
  toggleWorkArea,
  workAreaStorageKey,
} from "./workAreaStore.ts";
import { resetWorkAreaState } from "./resetWorkAreaState.ts";
import {
  WORK_AREA_DEFAULT_WIDTH,
  WORK_AREA_MAX_WIDTH,
  WORK_AREA_MIN_WIDTH,
} from "./workAreaTypes.ts";

class MemoryStorage {
  data = new Map();
  writes = [];
  failWrites = false;
  get length() {
    return this.data.size;
  }
  key(index) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.writes.push([key, value]);
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

const COMMUNITY_A = "ws://a.example";
const COMMUNITY_B = "ws://b.example";
let storage;
let tick = 0;

beforeEach(() => {
  storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  tick = 0;
  setWorkAreaClockForTests(() => ++tick);
  resetWorkAreaStore();
  initWorkAreaStore(COMMUNITY_A);
});

const stored = (scope = COMMUNITY_A) =>
  JSON.parse(storage.getItem(workAreaStorageKey(scope)));

test("opening a tab is one atomic write holding the whole layout", () => {
  openWorkArea("chan-1", "files");
  assert.equal(storage.writes.length, 1);
  const snapshot = stored();
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.channels["chan-1"].tabs, [
    { id: "files", kind: "files" },
  ]);
  assert.equal(snapshot.channels["chan-1"].open, true);
  assert.equal(snapshot.channels["chan-1"].activeTabId, "files");
});

test("every user action is exactly one write", () => {
  openWorkArea("chan-1", "terminal");
  openWorkArea("chan-1", "files");
  const before = storage.writes.length;
  selectWorkAreaTab("chan-1", "terminal");
  assert.equal(storage.writes.length, before + 1);
  setWorkAreaWidth("chan-1", 50);
  assert.equal(storage.writes.length, before + 2);
  closeWorkAreaTab("chan-1", "files");
  assert.equal(storage.writes.length, before + 3);
  // A no-op does not write.
  selectWorkAreaTab("chan-1", "terminal");
  assert.equal(storage.writes.length, before + 3);
});

test("closing the last tab closes the dock", () => {
  openWorkArea("chan-1", "files");
  closeWorkAreaTab("chan-1", "files");
  const state = getWorkAreaState("chan-1");
  assert.equal(state.open, false);
  assert.equal(state.tabs.length, 0);
  assert.equal(state.activeTabId, null);
});

test("closing the active tab activates its left neighbour", () => {
  openWorkArea("chan-1", "terminal");
  openWorkArea("chan-1", "files");
  closeWorkAreaTab("chan-1", "files");
  assert.equal(getWorkAreaState("chan-1").activeTabId, "terminal");
});

test("state survives a reload of the store (persistence is real)", () => {
  openWorkArea("chan-1", "files");
  setWorkAreaWidth("chan-1", 52);
  closeWorkArea("chan-1");
  resetWorkAreaStore();
  assert.equal(getWorkAreaState("chan-1").tabs.length, 0);
  initWorkAreaStore(COMMUNITY_A);
  const state = getWorkAreaState("chan-1");
  assert.equal(state.open, false);
  assert.equal(state.width, 52);
  assert.deepEqual(state.tabs, [{ id: "files", kind: "files" }]);
  assert.equal(state.activeTabId, "files");
});

test("each channel keeps its own layout", () => {
  openWorkArea("chan-1", "files");
  openWorkArea("chan-2", "terminal");
  setWorkAreaWidth("chan-2", 40);
  assert.deepEqual(getWorkAreaState("chan-1").tabs, [
    { id: "files", kind: "files" },
  ]);
  assert.equal(getWorkAreaState("chan-1").width, WORK_AREA_DEFAULT_WIDTH);
  assert.equal(getWorkAreaState("chan-2").width, 40);
  assert.equal(getWorkAreaState("chan-3").open, false);
});

test("a community switch resets in memory and re-hydrates per community", () => {
  openWorkArea("chan-1", "files");
  resetWorkAreaState();
  assert.equal(getWorkAreaState("chan-1").open, false);
  initWorkAreaStore(COMMUNITY_B);
  assert.equal(getWorkAreaState("chan-1").open, false);
  openWorkArea("chan-1", "terminal");
  assert.deepEqual(stored(COMMUNITY_B).channels["chan-1"].tabs, [
    { id: "terminal", kind: "terminal" },
  ]);
  // A's layout was never touched by B and comes back on return.
  assert.deepEqual(stored(COMMUNITY_A).channels["chan-1"].tabs, [
    { id: "files", kind: "files" },
  ]);
  resetWorkAreaState();
  initWorkAreaStore(COMMUNITY_A);
  assert.deepEqual(getWorkAreaState("chan-1").tabs, [
    { id: "files", kind: "files" },
  ]);
});

test("writes made while no community is applied are not persisted anywhere", () => {
  resetWorkAreaState();
  const writes = storage.writes.length;
  openWorkArea("chan-1", "files");
  assert.equal(storage.writes.length, writes);
});

test("width is clamped, rounded and resettable", () => {
  setWorkAreaWidth("chan-1", 5);
  assert.equal(getWorkAreaState("chan-1").width, WORK_AREA_MIN_WIDTH);
  setWorkAreaWidth("chan-1", 500);
  assert.equal(getWorkAreaState("chan-1").width, WORK_AREA_MAX_WIDTH);
  setWorkAreaWidth("chan-1", 51.6);
  assert.equal(getWorkAreaState("chan-1").width, 52);
  setWorkAreaWidth("chan-1", Number.NaN);
  assert.equal(getWorkAreaState("chan-1").width, WORK_AREA_DEFAULT_WIDTH);
  setWorkAreaWidth("chan-1", 40);
  resetWorkAreaWidth("chan-1");
  assert.equal(getWorkAreaState("chan-1").width, WORK_AREA_DEFAULT_WIDTH);
});

test("toggle flips the dock and keeps its tabs", () => {
  openWorkArea("chan-1", "files");
  toggleWorkArea("chan-1");
  assert.equal(getWorkAreaState("chan-1").open, false);
  toggleWorkArea("chan-1");
  assert.equal(getWorkAreaState("chan-1").open, true);
  assert.equal(getWorkAreaState("chan-1").tabs.length, 1);
});

test("stored data is validated: unknown kinds, junk and corrupt JSON are dropped", () => {
  const snapshot = parseWorkAreaSnapshot(
    JSON.stringify({
      version: 1,
      channels: {
        good: {
          open: true,
          tabs: [
            { id: "files", kind: "files" },
            { id: "files", kind: "files" },
            { id: "x", kind: "not-a-kind" },
            "nope",
          ],
          activeTabId: "missing",
          width: 9999,
        },
        bad: 12,
      },
    }),
  );
  assert.deepEqual(Object.keys(snapshot), ["good"]);
  assert.deepEqual(snapshot.good.tabs, [{ id: "files", kind: "files" }]);
  assert.equal(snapshot.good.activeTabId, "files");
  assert.equal(snapshot.good.width, WORK_AREA_MAX_WIDTH);
  assert.deepEqual(parseWorkAreaSnapshot("{not json"), {});
  assert.deepEqual(parseWorkAreaSnapshot(JSON.stringify({ version: 2 })), {});
  assert.deepEqual(parseWorkAreaSnapshot(null), {});
});

test("a failed write keeps memory state and the next change rewrites everything", () => {
  openWorkArea("chan-1", "files");
  storage.failWrites = true;
  openWorkArea("chan-2", "terminal");
  assert.equal(getWorkAreaPersistDirtyForTests(), true);
  assert.equal(getWorkAreaState("chan-2").open, true);
  storage.failWrites = false;
  setWorkAreaWidth("chan-1", 44);
  assert.equal(getWorkAreaPersistDirtyForTests(), false);
  const snapshot = stored();
  assert.equal(snapshot.channels["chan-2"].open, true);
  assert.equal(snapshot.channels["chan-1"].width, 44);
});

test("an owed write is retried even when the next action changes nothing", () => {
  storage.failWrites = true;
  openWorkArea("chan-1", "files");
  assert.equal(getWorkAreaPersistDirtyForTests(), true);
  storage.failWrites = false;
  selectWorkAreaTab("chan-1", "files");
  assert.equal(getWorkAreaPersistDirtyForTests(), false);
  assert.equal(stored().channels["chan-1"].open, true);
});

test("the remembered layout is bounded", () => {
  for (let index = 0; index < 230; index += 1) {
    openWorkArea(`chan-${index}`, "files");
  }
  const remembered = Object.keys(stored().channels);
  assert.equal(remembered.length, 200);
  assert.equal(remembered.includes("chan-229"), true);
  assert.equal(remembered.includes("chan-0"), false);
});

test("subscribers hear about real changes only", () => {
  let calls = 0;
  const unsubscribe = subscribeWorkArea(() => {
    calls += 1;
  });
  openWorkArea("chan-1", "files");
  assert.equal(calls, 1);
  selectWorkAreaTab("chan-1", "files");
  assert.equal(calls, 1);
  closeWorkArea("chan-1");
  assert.equal(calls, 2);
  unsubscribe();
  openWorkArea("chan-1", "files");
  assert.equal(calls, 2);
});
