import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OPT_IN_SURFACES,
  PATTERNS,
  REQUIRED_SURFACES,
  failingFindings,
  homeVerdict,
  promptCoverage,
  scanCapture,
  scanText,
  surfaceGroup,
} from "./brand-scan.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const clean = () => fixture("brand-capture-clean.json");
const leaky = () => fixture("brand-capture-leaky.json");
const kinds = (findings) => findings.map((f) => f.kind).sort();

test("a clean capture passes every required surface and records no failing finding", () => {
  const scan = scanCapture(clean());
  assert.equal(scan.status, "PASS");
  assert.deepEqual(scan.missing, []);
  for (const name of REQUIRED_SURFACES) {
    assert.equal(scan.groups[name].status, "PASS", name);
    assert.ok(scan.groups[name].observed > 0, name);
  }
  assert.deepEqual(failingFindings(scan), []);
  // The chat reply names the working folder: reported as information, never a failure.
  assert.deepEqual(
    scan.findings.map((f) => `${f.kind}:${f.severity}`),
    ["home-path:info"],
  );
});

test("opt-in raw surfaces may show flags, pipes, UUIDs and redirects", () => {
  const scan = scanCapture(clean());
  for (const name of OPT_IN_SURFACES) {
    assert.equal(scan.groups[name].status, "PASS", name);
    assert.deepEqual(scan.groups[name].findings, [], name);
  }
});

test("the leaks the 1.0.5 gate found are all caught, with exact kinds per surface", () => {
  const scan = scanCapture(leaky());
  assert.equal(scan.status, "FAIL");
  const failing = failingFindings(scan);
  assert.equal(failing.length, 12);
  assert.deepEqual(kinds(failing.filter((f) => f.surface === "chat")), [
    "buzz",
    "buzz",
    "buzz",
  ]);
  assert.deepEqual(kinds(failing.filter((f) => f.surface === "transcript")), [
    "buzz",
    "flag",
    "flag",
    "flag",
    "uuid",
  ]);
  assert.deepEqual(
    kinds(failing.filter((f) => f.surface === "session-panel")),
    ["pipe"],
  );
  assert.deepEqual(kinds(failing.filter((f) => f.surface === "activity-page")), [
    "buzz",
  ]);
  assert.deepEqual(
    kinds(failing.filter((f) => f.surface === "activity-strip")),
    ["buzz"],
  );
  // The popover is opt-in: its flags are fine, its old name is not.
  assert.deepEqual(
    kinds(failing.filter((f) => f.surface === "details-popover")),
    ["buzz"],
  );
  assert.equal(scan.groups["transcript-expanded"].status, "PASS");
  assert.equal(failing.filter((f) => f.kind === "buzz").length, 7);
});

test("failing findings list the old name before raw-command symptoms", () => {
  const order = failingFindings(scanCapture(leaky())).map((f) => f.kind);
  const firstOther = order.findIndex((kind) => kind !== "buzz");
  assert.ok(firstOther > 0);
  assert.ok(order.slice(firstOther).every((kind) => kind !== "buzz"));
});

test("the old name is caught in any case and in paths, attributes and window titles", () => {
  for (const text of [
    "buzz",
    "Buzz",
    "BUZZ",
    "bUzZ",
    "the Buzz app",
    "/Users/me/.buzz/notes.md",
    "buzz-agent",
    "xbuzzx",
  ]) {
    assert.deepEqual(kinds(scanText(text, "chat").filter((f) => f.kind === "buzz")), [
      "buzz",
    ]);
  }
  const scan = scanCapture({
    surfaces: {
      "activity-strip.attr.aria-label": ["Open Buzz activity"],
      "chat.attr.title": ["buzz"],
    },
  });
  assert.equal(scan.groups["activity-strip"].status, "FAIL");
  assert.equal(scan.groups.chat.status, "FAIL");
});

test("falsifiable: injecting the old name into any one required surface fails exactly that surface", () => {
  for (const injected of REQUIRED_SURFACES) {
    const capture = clean();
    capture.surfaces[injected] = [
      ...capture.surfaces[injected],
      "Run `buzz mem get core` first.",
    ];
    const scan = scanCapture(capture);
    assert.equal(scan.status, "FAIL", injected);
    for (const name of REQUIRED_SURFACES)
      assert.equal(
        scan.groups[name].status,
        name === injected ? "FAIL" : "PASS",
        `${injected} injected, ${name} judged`,
      );
  }
});

test("falsifiable: injecting the old name into an opt-in surface fails it too", () => {
  for (const injected of OPT_IN_SURFACES) {
    const capture = clean();
    capture.surfaces[injected] = [...capture.surfaces[injected], "buzz mem ls"];
    const scan = scanCapture(capture);
    assert.equal(scan.groups[injected].status, "FAIL", injected);
    assert.equal(scan.status, "FAIL", injected);
  }
});

test("a surface that was never observed is NOT OBSERVED, never PASS", () => {
  for (const missing of REQUIRED_SURFACES) {
    const capture = clean();
    for (const key of Object.keys(capture.surfaces))
      if (surfaceGroup(key) === missing) delete capture.surfaces[key];
    const scan = scanCapture(capture);
    assert.equal(scan.groups[missing].status, "NOT OBSERVED", missing);
    assert.deepEqual(scan.missing, [missing]);
    assert.equal(scan.status, "NOT OBSERVED", missing);
  }
  const blanks = scanCapture({ surfaces: { chat: ["", "   ", "\n"] } });
  assert.equal(blanks.groups.chat.observed, 0);
  assert.equal(blanks.status, "NOT OBSERVED");
  assert.equal(scanCapture({}).status, "NOT OBSERVED");
  assert.equal(scanCapture(null).status, "NOT OBSERVED");
});

test("a failure outranks missing surfaces", () => {
  const scan = scanCapture({ surfaces: { chat: ["buzz"] } });
  assert.equal(scan.status, "FAIL");
  assert.ok(scan.missing.includes("transcript"));
});

test("flags are commands, not hyphens: file names, bullets and words with hyphens pass", () => {
  for (const text of [
    "created gate-check.md",
    "- a bullet point",
    "a well-known approach",
    "up-to-date notes",
    "call me at 555-0100",
    "range 1 - 5",
  ])
    assert.deepEqual(scanText(text, "chat"), [], text);
  for (const text of ["run colony --help", "use -h for help", "--format compact"])
    assert.ok(
      scanText(text, "chat").some((f) => f.kind === "flag"),
      text,
    );
});

test("UUIDs, pipes and redirects are caught on plain surfaces in any case", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.ok(scanText(`channel ${id}`, "chat").some((f) => f.kind === "uuid"));
  assert.ok(
    scanText(`channel ${id.toUpperCase()}`, "chat").some((f) => f.kind === "uuid"),
  );
  assert.ok(scanText("a | b", "activity-strip").some((f) => f.kind === "pipe"));
  assert.ok(
    scanText("run it 2>&1 now", "transcript").some((f) => f.kind === "redirect"),
  );
  assert.deepEqual(scanText(`channel ${id}`, "details-popover"), []);
});

test("every failing pattern kind is exercised by a fixture so none can rot silently", () => {
  const seen = new Set(failingFindings(scanCapture(leaky())).map((f) => f.kind));
  seen.add("redirect");
  for (const pattern of PATTERNS.filter((p) => p.severity === "fail"))
    assert.ok(seen.has(pattern.kind), `no fixture exercises ${pattern.kind}`);
});

test("findings carry the surface, the match and readable context", () => {
  const [finding] = scanText(
    "Your files are in /Users/test/.buzz/gate-check.md today",
    "chat",
  ).filter((f) => f.kind === "buzz");
  assert.equal(finding.surface, "chat");
  assert.equal(finding.match, "buzz");
  assert.match(finding.context, /\.buzz\/gate-check\.md/u);
});

test("home verdict: a fresh install creates .colony and never .buzz", () => {
  assert.equal(
    homeVerdict({ before: ["Library"], after: ["Library", ".colony"] }).status,
    "PASS",
  );
  assert.equal(
    homeVerdict({ before: [], after: [".colony", ".buzz"] }).status,
    "FAIL",
  );
  assert.equal(
    homeVerdict({ before: [], after: [".buzz"] }).status,
    "FAIL",
  );
  assert.equal(
    homeVerdict({ before: [], after: ["Library"] }).status,
    "NOT OBSERVED",
  );
  // A HOME that already had either folder proves nothing about a fresh install.
  assert.equal(
    homeVerdict({ before: [".buzz"], after: [".buzz", ".colony"] }).status,
    "BLOCKED",
  );
  assert.equal(
    homeVerdict({ before: [".colony"], after: [".colony"] }).status,
    "BLOCKED",
  );
});

test("prompt coverage: tool activity must have been seen before silence reads as clean", () => {
  assert.equal(promptCoverage([]).status, "NOT OBSERVED");
  assert.equal(
    promptCoverage([{ firstRowMs: null }, { firstRowMs: null }]).status,
    "NOT OBSERVED",
  );
  assert.equal(
    promptCoverage([{ firstRowMs: 900 }, { firstRowMs: null }]).status,
    "INCOMPLETE",
  );
  assert.equal(
    promptCoverage([{ firstRowMs: 900 }, { firstRowMs: 1200 }]).status,
    "PASS",
  );
});
