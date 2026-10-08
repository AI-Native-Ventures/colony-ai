import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WK_ROWS,
  containsAll,
  judgeKnowledgeSections,
  judgeWorkBody,
  noteMarkdown,
  notePreview,
  overallVerdict,
  pinMessageText,
  rawTextFindings,
  runTag,
  runWorkKnowledgeRows,
} from "./work-knowledge-rows.mjs";
import { buildWorkKnowledgeReport } from "./work-knowledge-report.mjs";

const TAG = runTag("a1b2c3");

/**
 * A scripted app. `relay` is what the live relay holds, `screen` what the person sees. A reload
 * rebuilds the screen from the relay, so an action that never reaches the relay (a lying UI)
 * disappears on reload exactly as it would in the packaged app.
 */
function fakeApp(overrides = {}) {
  const relay = { canvas: null, pins: [], messages: [] };
  const screen = { tab: null, pins: [], canvas: null, unpinnedLocally: false };
  const opts = {
    saveCanvas: true,
    refusePin: false,
    relayKeepsPins: true,
    relayKeepsCanvas: true,
    relayHonoursDelete: true,
    sidebarBack: true,
    loadingAfterUnpin: false,
    ...overrides,
  };
  const ctx = {
    relay,
    screen,
    async channelState() {
      return (
        opts.channelState ?? {
          inChannel: true,
          headerTabs: true,
          composer: true,
        }
      );
    },
    async openDockTab(tab) {
      screen.tab = tab;
      return { selected: true };
    },
    async dockText() {
      if (screen.tab === "work")
        return opts.workText ?? "No work in this channel yet";
      return "Knowledge";
    },
    async dockHas() {
      return false;
    },
    async sectionText(testId) {
      if (testId === "work-area-knowledge-notes")
        return screen.canvas
          ? `Channel notes Canvas ${screen.canvas}`
          : "Channel notes";
      if (testId === "work-area-knowledge-pins")
        if (screen.unpinnedLocally && opts.loadingAfterUnpin)
          return "Pinned Loading pinned messages";
      if (testId === "work-area-knowledge-pins")
        return screen.pins.length
          ? screen.pins.map((text) => `${text} Pinned by You`).join(" ")
          : "No pinned messages yet.";
      return null;
    },
    async createCanvasNote(markdown) {
      if (!opts.saveCanvas) return { saved: false, shown: "" };
      const preview = markdown.split("\n")[0].replace(/^#\s*/u, "");
      relay.canvas = preview;
      screen.canvas = preview;
      return { saved: true, shown: preview };
    },
    async sendMessage(text) {
      relay.messages.push(text);
      return { sent: true };
    },
    async pinMessage(text) {
      if (opts.refusePin)
        return {
          toastSeen: false,
          errorToast: "Couldn't pin the message. Try again.",
          menuAfter: "Pin to channel",
        };
      relay.pins.push(text);
      screen.pins.push(text);
      return {
        toastSeen: true,
        errorToast: null,
        menuAfter: "Unpin from channel",
      };
    },
    async openPinsScreen() {
      return screen.pins.join(" ");
    },
    async reload() {
      screen.tab = null;
      screen.pins = opts.relayKeepsPins ? [...relay.pins] : [];
      screen.canvas = opts.relayKeepsCanvas ? relay.canvas : null;
      return { sidebar: opts.sidebarBack, channel: opts.sidebarBack };
    },
    async unpinFromKnowledge(text) {
      screen.unpinnedLocally = true;
      screen.pins = screen.pins.filter((item) => item !== text);
      if (opts.relayHonoursDelete)
        relay.pins = relay.pins.filter((item) => item !== text);
      return { gone: !screen.pins.includes(text), toastSeen: true };
    },
    async shot(name) {
      return `screenshots/${name}.png`;
    },
  };
  return ctx;
}

async function run(overrides, options = {}) {
  const ctx = fakeApp(overrides);
  const rows = [];
  const record = (id, label, status, detail, extra = {}) =>
    rows.push({ id, label, status, detail, ...extra });
  const outcome = await runWorkKnowledgeRows(ctx, record, {
    tag: TAG,
    ...options,
  });
  return { ctx, rows, outcome };
}

const statuses = (outcome, ids) => ids.map((id) => outcome[id]);

test("row registry: unique ids, every prerequisite exists and runs earlier", () => {
  const ids = WK_ROWS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  WK_ROWS.forEach((spec, index) => {
    for (const need of spec.needs)
      assert.ok(
        ids.indexOf(need) >= 0 && ids.indexOf(need) < index,
        `${spec.id} needs ${need}`,
      );
  });
});

test("a healthy app: every row PASS, overall PASS, unique run strings round trip", async () => {
  const { rows, outcome, ctx } = await run();
  assert.equal(rows.length, WK_ROWS.length);
  assert.deepEqual(
    rows.filter((item) => item.status !== "PASS"),
    [],
  );
  assert.equal(overallVerdict(rows).status, "PASS");
  assert.deepEqual(ctx.relay.pins, []);
  assert.deepEqual(ctx.relay.messages, [pinMessageText(TAG)]);
  assert.equal(outcome.WK13, "PASS");
});

test("WK13 cannot pass on absence while the Pinned section is loading", async () => {
  const { rows, outcome } = await run({ loadingAfterUnpin: true });
  assert.equal(outcome.WK12, "PASS");
  assert.equal(outcome.WK13, "BLOCKED");
  assert.match(rows.find((row) => row.id === "WK13").detail, /has not loaded/u);
});

test("a relay that refuses the pin fails WK5 and blocks everything that depends on a pin", async () => {
  const { outcome, rows } = await run({ refusePin: true });
  assert.equal(outcome.WK5, "FAIL");
  assert.deepEqual(
    statuses(outcome, ["WK6", "WK7", "WK10", "WK12", "WK13"]),
    Array(5).fill("BLOCKED"),
  );
  assert.deepEqual(
    statuses(outcome, [
      "WK0",
      "WK1",
      "WK2",
      "WK3",
      "WK4",
      "WK8",
      "WK9",
      "WK11",
    ]),
    Array(8).fill("PASS"),
  );
  assert.match(rows.find((item) => item.id === "WK5").detail, /kind 40004/u);
  assert.equal(overallVerdict(rows).status, "FAIL");
});

test("a pin the relay does not keep passes on screen but fails after the reload", async () => {
  const { outcome } = await run({ relayKeepsPins: false });
  assert.deepEqual(statuses(outcome, ["WK5", "WK6", "WK7"]), [
    "PASS",
    "PASS",
    "PASS",
  ]);
  assert.equal(outcome.WK10, "FAIL");
  assert.deepEqual(statuses(outcome, ["WK12", "WK13"]), ["BLOCKED", "BLOCKED"]);
});

test("a note the relay does not keep fails WK9 only", async () => {
  const { outcome } = await run({ relayKeepsCanvas: false });
  assert.equal(outcome.WK3, "PASS");
  assert.equal(outcome.WK4, "PASS");
  assert.equal(outcome.WK9, "FAIL");
  assert.equal(outcome.WK10, "PASS");
  assert.equal(outcome.WK13, "BLOCKED");
});

test("an unpin that only hides the row is caught by the second reload", async () => {
  const { outcome, rows } = await run({ relayHonoursDelete: false });
  assert.equal(outcome.WK12, "PASS");
  assert.equal(outcome.WK13, "FAIL");
  assert.match(
    rows.find((item) => item.id === "WK13").detail,
    /did not reach the relay/u,
  );
});

test("a canvas that cannot be saved fails WK3 and blocks the note rows", async () => {
  const { outcome } = await run({ saveCanvas: false });
  assert.equal(outcome.WK3, "FAIL");
  assert.deepEqual(
    statuses(outcome, ["WK4", "WK9", "WK13"]),
    Array(3).fill("BLOCKED"),
  );
  assert.equal(outcome.WK5, "PASS");
});

test("no channel: WK0 fails and nothing else is attempted", async () => {
  const { outcome, rows } = await run({
    channelState: { inChannel: false, headerTabs: false, composer: false },
  });
  assert.equal(outcome.WK0, "FAIL");
  const others = rows.filter((item) => item.id !== "WK0");
  assert.equal(others.length, WK_ROWS.length - 1);
  assert.ok(others.every((item) => item.status === "BLOCKED"));
});

test("a reload that does not bring the app back blocks the reload rows", async () => {
  const { outcome } = await run({ sidebarBack: false });
  assert.equal(outcome.WK8, "FAIL");
  assert.deepEqual(
    statuses(outcome, ["WK9", "WK10", "WK11", "WK12", "WK13"]),
    Array(5).fill("BLOCKED"),
  );
});

test("unpin rows are optional", async () => {
  const { outcome } = await run({}, { withUnpin: false });
  assert.equal("WK12" in outcome, false);
  assert.equal("WK13" in outcome, false);
  assert.equal(outcome.WK11, "PASS");
});

test("a row that throws becomes FAIL with a one line reason, never a crash", async () => {
  const ctx = fakeApp();
  ctx.createCanvasNote = async () => {
    throw new TypeError("locator timed out\nsecond line");
  };
  const rows = [];
  const outcome = await runWorkKnowledgeRows(
    ctx,
    (id, _label, status, detail) => rows.push({ id, status, detail }),
    { tag: TAG },
  );
  assert.equal(outcome.WK3, "FAIL");
  assert.equal(
    rows.find((item) => item.id === "WK3").detail,
    "Step threw TypeError: locator timed out",
  );
});

test("judgeWorkBody", () => {
  const ok = (input) => judgeWorkBody(input).status;
  assert.equal(ok({ selected: true, text: "", hasRows: true }), "PASS");
  assert.equal(
    ok({ selected: true, text: "No work in this channel yet", hasRows: false }),
    "PASS",
  );
  assert.equal(
    ok({ selected: true, text: "No work is listed here", hasRows: false }),
    "PASS",
  );
  assert.equal(
    ok({
      selected: false,
      text: "No work in this channel yet",
      hasRows: false,
    }),
    "FAIL",
  );
  assert.equal(
    ok({ selected: true, text: "Work could not be loaded", hasRows: false }),
    "FAIL",
  );
  assert.equal(
    ok({ selected: true, text: "You are not in this channel", hasRows: false }),
    "FAIL",
  );
  assert.equal(
    ok({
      selected: true,
      text: "relay returned 500 Internal Server Error",
      hasRows: true,
    }),
    "FAIL",
  );
  assert.equal(
    ok({ selected: true, text: "something unknown", hasRows: false }),
    "FAIL",
  );
});

test("judgeKnowledgeSections", () => {
  const base = {
    selected: true,
    hasNotes: true,
    hasPins: true,
    pinsText: "No pinned messages yet.",
    text: "Knowledge",
  };
  assert.equal(judgeKnowledgeSections(base).status, "PASS");
  assert.equal(
    judgeKnowledgeSections({ ...base, selected: false }).status,
    "FAIL",
  );
  assert.equal(
    judgeKnowledgeSections({ ...base, hasNotes: false }).status,
    "FAIL",
  );
  assert.equal(
    judgeKnowledgeSections({ ...base, hasPins: false }).status,
    "FAIL",
  );
  assert.equal(
    judgeKnowledgeSections({
      ...base,
      pinsText: "Pinned messages could not be loaded.",
    }).status,
    "FAIL",
  );
  assert.equal(
    judgeKnowledgeSections({ ...base, pinsText: "Loading pinned messages" })
      .status,
    "FAIL",
  );
  assert.equal(
    judgeKnowledgeSections({ ...base, text: "status 503 from relay" }).status,
    "FAIL",
  );
});

test("rawTextFindings flags transport words and stays quiet on plain copy", () => {
  assert.deepEqual(rawTextFindings("No work in this channel yet"), []);
  assert.deepEqual(
    rawTextFindings("Colony could not reach this community. Try again."),
    [],
  );
  assert.equal(
    rawTextFindings("relay returned 500 Internal Server Error").length,
    1,
  );
  assert.equal(rawTextFindings("Pinned by [object Object]").length, 1);
  assert.equal(rawTextFindings("at fetchPins (app.js:10:4)").length, 1);
  assert.equal(rawTextFindings("Total: NaN").length, 1);
  assert.deepEqual(rawTextFindings("Pinned by Nan"), []);
});

test("containsAll reports what is missing", () => {
  assert.deepEqual(containsAll("one two", ["one", "two"]), {
    ok: true,
    missing: [],
  });
  assert.deepEqual(containsAll("one", ["one", "two"]), {
    ok: false,
    missing: ["two"],
  });
  assert.deepEqual(containsAll(null, ["x"]), { ok: false, missing: ["x"] });
});

test("run tag, note and pin text are unique per tag and the preview matches the markdown", () => {
  const other = runTag("ffeedd");
  assert.notEqual(pinMessageText(TAG), pinMessageText(other));
  assert.notEqual(notePreview(TAG), notePreview(other));
  assert.equal(noteMarkdown(TAG).split("\n")[0], `# ${notePreview(TAG)}`);
  assert.throws(() => runTag("nothex"));
  assert.throws(() => runTag("ab"));
});

test("the text typed into the app never mentions anyone and never uses the old product name", () => {
  for (const text of [pinMessageText(TAG), noteMarkdown(TAG)]) {
    assert.equal(text.includes("@"), false);
    assert.equal(/\b(?:Buzz|Fizz|Honey|Pollen)\b/iu.test(text), false);
  }
});

test("overallVerdict", () => {
  assert.equal(overallVerdict([]).status, "INCOMPLETE");
  assert.equal(overallVerdict([{ id: "A", status: "PASS" }]).status, "PASS");
  assert.equal(
    overallVerdict([
      { id: "A", status: "PASS" },
      { id: "B", status: "BLOCKED" },
    ]).status,
    "INCOMPLETE",
  );
  assert.equal(
    overallVerdict([
      { id: "A", status: "FAIL" },
      { id: "B", status: "BLOCKED" },
    ]).status,
    "FAIL",
  );
});

test("the report escapes what it prints and shows every row with its status class", () => {
  const html = buildWorkKnowledgeReport({
    title: "Gate <report>",
    verdict: { status: "FAIL", headline: "1 row(s) failed: WK5." },
    rows: [
      {
        id: "WK5",
        label: "Pin",
        status: "FAIL",
        detail: "<script>x</script>",
        tMs: 1500,
      },
      { id: "WK6", label: "List", status: "BLOCKED", detail: "n/a" },
    ],
    accounts: [{ email: "a@b.c", role: "smoke" }],
  });
  assert.ok(!html.includes("<script>x"));
  assert.ok(html.includes("&lt;script&gt;x"));
  assert.ok(html.includes('class="fail">FAIL'));
  assert.ok(html.includes('class="no">BLOCKED'));
  assert.ok(html.includes("1.5 s"));
  assert.ok(html.includes("a@b.c"));
});

test("project rule: no em dash in the gate files", async () => {
  const dash = String.fromCodePoint(0x2014);
  for (const file of [
    "work-knowledge-rows.mjs",
    "work-knowledge-rows.test.mjs",
    "work-knowledge-page.mjs",
    "work-knowledge-proof.mjs",
    "work-knowledge-report.mjs",
  ]) {
    const source = await readFile(
      new URL(`./${file}`, import.meta.url),
      "utf8",
    );
    assert.equal(source.includes(dash), false, file);
  }
});
