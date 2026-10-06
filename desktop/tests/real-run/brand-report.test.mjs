import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBrandReport, esc, statusClass } from "./brand-report.mjs";
import { scanCapture } from "./brand-scan.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );

const model = (capture, overrides = {}) => {
  const scan = scanCapture(capture);
  return {
    title: "Colony fresh-HOME brand proof",
    verdict: { status: scan.status, headline: "Headline text." },
    version: "1.0.6",
    app: "/path/Colony.app",
    relay: "https://relay.example.com",
    window: "today",
    rows: [
      {
        id: "H1",
        label: "Fresh HOME",
        status: "PASS",
        detail: "ok",
        tMs: 1500,
      },
    ],
    scan,
    surfaces: capture.surfaces,
    prompts: [
      {
        id: 1,
        name: "business",
        firstRowMs: 2200,
        endedBecause: "idle",
        elapsedMs: 30000,
        rowTextsSeen: ["Checking channels"],
      },
    ],
    method: ["HOME was a throwaway directory."],
    knownRemainder: ["Legacy installs keep .buzz until the migration."],
    accounts: [{ email: "smoke@example.com", role: "owner" }],
    home: {
      path: "/private/tmp/colony-fresh",
      before: [],
      after: [".colony"],
      tree: [".colony/AGENTS.md"],
    },
    ...overrides,
  };
};

test("status classes follow the earlier gate reports", () => {
  assert.equal(statusClass("PASS"), "pass");
  assert.equal(statusClass("FAIL"), "fail");
  for (const status of ["NOT OBSERVED", "BLOCKED", "INCOMPLETE", "UNPROVEN"])
    assert.equal(statusClass(status), "no");
  assert.equal(statusClass("something else"), "info");
  assert.equal(statusClass(undefined), "info");
});

test("a clean run renders PASS and one status cell per required surface", () => {
  const html = buildBrandReport(model(fixture("brand-capture-clean.json")));
  assert.match(html, /<p class="verdict pass">PASS<\/p>/u);
  for (const name of [
    "chat",
    "transcript",
    "session-panel",
    "activity-page",
    "activity-strip",
  ])
    assert.match(
      html,
      new RegExp(`<code>${name}</code></td><td class="pass">PASS</td>`, "u"),
      name,
    );
  assert.doesNotMatch(html, /class="fail"/u);
  assert.match(html, /Throwaway HOME/u);
  assert.match(html, /smoke@example\.com/u);
});

test("a leaky run renders FAIL and lists each finding with its surface and match", () => {
  const html = buildBrandReport(model(fixture("brand-capture-leaky.json")));
  assert.match(html, /<p class="verdict fail">FAIL<\/p>/u);
  assert.match(html, /<code>chat<\/code>/u);
  assert.match(
    html,
    /<td class="fail">buzz<\/td><td><code>buzz<\/code><\/td>/u,
  );
  assert.match(html, /<td class="fail">uuid<\/td>/u);
  assert.match(html, /Findings \(13\)/u);
});

test("an unobserved surface renders NOT OBSERVED and the verdict is not PASS", () => {
  const html = buildBrandReport(model({ surfaces: { chat: ["hello"] } }));
  assert.match(html, /<p class="verdict no">NOT OBSERVED<\/p>/u);
  assert.match(
    html,
    /<code>activity-strip<\/code><\/td><td class="no">NOT OBSERVED<\/td>/u,
  );
});

test("everything printed is escaped, and no em dash survives", () => {
  const html = buildBrandReport(
    model(
      { surfaces: { chat: ['<script>alert("x")</script> — done'] } },
      { verdict: { status: "FAIL", headline: "a <b>bold</b> — claim" } },
    ),
  );
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /&lt;script&gt;alert/u);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/u);
  assert.equal(html.includes("—"), false);
  assert.equal(esc("<&>"), "&lt;&amp;&gt;");
});

test("the page is self-contained: inline style, no external script or stylesheet", () => {
  const html = buildBrandReport(model(fixture("brand-capture-clean.json")));
  assert.match(html, /<style>/u);
  assert.doesNotMatch(html, /<script/u);
  assert.doesNotMatch(html, /<link /u);
  assert.match(html, /prefers-color-scheme:dark/u);
});
