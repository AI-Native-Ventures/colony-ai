import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLECTOR,
  READ_COLLECTED,
  SET_MODE,
  mergeCollected,
} from "./brand-collector.mjs";
import { scanCapture } from "./brand-scan.mjs";

// A minimal DOM: enough to run the collector's real code, not a browser.
function fakeDom({
  timeline = [],
  row = null,
  panel = null,
  main = [],
  title = "Colony",
}) {
  const visibleEl = () => ({
    tagName: "DIV",
    parentElement: null,
    children: [],
    getClientRects: () => [1],
  });
  const element = (texts, attrs = {}) => ({
    ...visibleEl(),
    __texts: texts,
    innerText: texts.join(" "),
    textContent: texts.join(" "),
    getAttribute: (name) => attrs[name] ?? null,
    querySelectorAll: () => [],
    contains: () => false,
  });
  const nodes = {
    "message-timeline": timeline.length ? element(timeline) : null,
    "channel-composer-activity-row": row
      ? element(row, { "aria-label": "Activity" })
      : null,
    "agent-session-thread-panel": panel ? element(panel) : null,
  };
  const intervals = [];
  const document = {
    title,
    body: element(main),
    querySelector: (selector) => {
      const id = /data-testid="([^"]+)"/u.exec(selector)?.[1];
      if (id) return nodes[id] ?? null;
      return selector === "main" ? element(main) : null;
    },
    querySelectorAll: () => [],
    createTreeWalker: (root) => {
      let i = -1;
      return {
        currentNode: null,
        nextNode() {
          i += 1;
          if (i >= (root.__texts?.length ?? 0)) return false;
          this.currentNode = {
            textContent: root.__texts[i],
            parentElement: visibleEl(),
          };
          return true;
        },
      };
    },
  };
  return { document, intervals };
}

function install(dom) {
  const saved = {};
  const globals = {
    window: {},
    document: dom.document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn) => fn(),
    setInterval: (fn) => {
      dom.intervals.push(fn);
      return 1;
    },
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  };
  for (const [key, value] of Object.entries(globals)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  return () => {
    for (const [key, descriptor] of Object.entries(saved))
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : delete globalThis[key];
  };
}

test("the collector records chat, the activity strip and the window title, and the scanner judges them", () => {
  const dom = fakeDom({
    timeline: ["Hi from Scout", "I ran `buzz mem get core`"],
    row: ["Checking channels"],
    title: "Colony",
  });
  const restore = install(dom);
  try {
    assert.equal(COLLECTOR(), "installed");
    assert.equal(COLLECTOR(), "exists");
    dom.intervals[0]();
    const read = READ_COLLECTED();
    assert.deepEqual(read.surfaces.chat, [
      "Hi from Scout",
      "I ran `buzz mem get core`",
    ]);
    assert.ok(read.surfaces["activity-strip"].includes("Checking channels"));
    assert.deepEqual(read.surfaces["window-title"], ["Colony"]);
    const scan = scanCapture(read);
    assert.equal(scan.groups.chat.status, "FAIL");
    assert.equal(scan.groups["activity-strip"].status, "PASS");
  } finally {
    restore();
  }
});

test("the collector attributes panel text to session-panel and transcript, and to the expanded surface in expanded mode", () => {
  const dom = fakeDom({ panel: ["Created gate-check.md", "3 tool calls"] });
  const restore = install(dom);
  try {
    COLLECTOR();
    dom.intervals[0]();
    let read = READ_COLLECTED();
    assert.deepEqual(read.surfaces["session-panel"], [
      "Created gate-check.md",
      "3 tool calls",
    ]);
    assert.deepEqual(read.surfaces.transcript, [
      "Created gate-check.md",
      "3 tool calls",
    ]);
    assert.equal(read.surfaces["transcript-expanded"], undefined);
    SET_MODE("panel-expanded");
    dom.intervals[0]();
    read = READ_COLLECTED();
    assert.deepEqual(read.surfaces["transcript-expanded"], [
      "Created gate-check.md",
      "3 tool calls",
    ]);
  } finally {
    restore();
  }
});

test("mode switches attribute page text to the Activity page and the Team page", () => {
  const dom = fakeDom({ main: ["Activity", "Scout posted in general"] });
  const restore = install(dom);
  try {
    COLLECTOR();
    SET_MODE("activity");
    dom.intervals[0]();
    SET_MODE("team");
    dom.intervals[0]();
    const read = READ_COLLECTED();
    assert.deepEqual(read.surfaces["activity-page"], [
      "Activity",
      "Scout posted in general",
    ]);
    assert.deepEqual(read.surfaces["team-page"], [
      "Activity",
      "Scout posted in general",
    ]);
  } finally {
    restore();
  }
});

test("reads before a reload and after it merge without losing text", () => {
  const merged = mergeCollected(
    { ticks: 5, surfaces: { chat: ["a", "b"], "activity-strip": ["x"] } },
    { ticks: 2, surfaces: { chat: ["b", "c"], "session-panel": ["p"] } },
  );
  assert.equal(merged.ticks, 5);
  assert.deepEqual(merged.surfaces.chat, ["a", "b", "c"]);
  assert.deepEqual(merged.surfaces["activity-strip"], ["x"]);
  assert.deepEqual(merged.surfaces["session-panel"], ["p"]);
  assert.deepEqual(mergeCollected(null, null), { ticks: 0, surfaces: {} });
});

test("READ_COLLECTED is null before the collector is installed", () => {
  const dom = fakeDom({});
  const restore = install(dom);
  try {
    assert.equal(READ_COLLECTED(), null);
  } finally {
    restore();
  }
});
