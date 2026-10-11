import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_TYPE_CHARS,
  TOOLS,
  isToolName,
  toolDescriptors,
  toolNames,
  validateToolInput,
  WEB_TASKS,
} from "./tool-definitions.mjs";

test("the tool list is exactly the approved surface", () => {
  assert.deepEqual(toolNames(), [
    "browser_connect",
    "browser_tabs",
    "browser_open",
    "browser_close",
    "browser_navigate",
    "browser_snapshot",
    "browser_screenshot",
    "browser_read",
    "browser_click",
    "browser_type",
    "browser_select",
    "browser_scroll",
    "browser_wait",
    "browser_download",
    "browser_upload",
  ]);
});

test("no tool can evaluate script, speak raw CDP or touch cookies and storage", () => {
  const forbidden =
    /(evaluate|eval\b|script|cdp|devtools|cookie|storage|header|credential|password_value|clipboard|extension|file_path|filepath|execute)/iu;
  for (const tool of TOOLS) {
    assert.ok(!forbidden.test(tool.name), tool.name);
    for (const key of Object.keys(tool.inputSchema.properties))
      assert.ok(!forbidden.test(key), `${tool.name}.${key}`);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }
  // No argument anywhere can carry a filesystem path: uploads use opaque ids.
  const upload = TOOLS.find((tool) => tool.name === "browser_upload");
  assert.deepEqual(Object.keys(upload.inputSchema.properties), [
    "tab",
    "ref",
    "uploadId",
  ]);
});

test("descriptors are plain JSON and tools that return page text warn about it", () => {
  const descriptors = toolDescriptors();
  assert.equal(descriptors.length, TOOLS.length);
  assert.deepEqual(JSON.parse(JSON.stringify(descriptors)), descriptors);
  for (const name of [
    "browser_snapshot",
    "browser_read",
    "browser_navigate",
    "browser_open",
  ]) {
    const tool = descriptors.find((entry) => entry.name === name);
    assert.ok(/untrusted data/u.test(tool.description), name);
  }
  assert.equal(isToolName("browser_click"), true);
  assert.equal(isToolName("browser_evaluate"), false);
  assert.equal(isToolName(undefined), false);
  assert.equal(isToolName("__proto__"), false);
});

test("connect and open say how web tasks are done, in the shared words", () => {
  const descriptors = toolDescriptors();
  for (const name of ["browser_connect", "browser_open"]) {
    const tool = descriptors.find((entry) => entry.name === name);
    assert.ok(tool.description.endsWith(WEB_TASKS), name);
  }
  const rules = readFileSync(
    new URL("../../../crates/buzz-acp/src/web_tasks.md", import.meta.url),
    "utf8",
  );
  const shared = WEB_TASKS.match(/Never reach a website another way:[^.]*\./u);
  assert.ok(shared, "the line names what agents must never do");
  assert.ok(
    rules.includes(shared[0]),
    "the line is copied word for word from the one rule file",
  );
});

test("valid input passes and is copied", () => {
  const input = { tab: "t1", ref: "e12", text: "hello", submit: true };
  const result = validateToolInput("browser_type", input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, input);
  assert.notEqual(result.value, input);
  assert.equal(validateToolInput("browser_tabs", undefined).ok, true);
  assert.equal(validateToolInput("browser_tabs", null).ok, true);
  assert.equal(validateToolInput("browser_tabs", {}).ok, true);
});

test("unknown tools, unknown keys and non objects are rejected", () => {
  assert.equal(validateToolInput("browser_eval", {}).ok, false);
  assert.equal(validateToolInput("constructor", {}).ok, false);
  assert.equal(validateToolInput("browser_tabs", { extra: 1 }).ok, false);
  assert.equal(
    validateToolInput("browser_click", { tab: "t1", ref: "e1", script: "x" })
      .ok,
    false,
  );
  assert.equal(validateToolInput("browser_tabs", []).ok, false);
  assert.equal(validateToolInput("browser_tabs", "x").ok, false);
});

test("required fields, types, patterns and bounds are enforced", () => {
  const bad = [
    ["browser_click", { tab: "t1" }],
    ["browser_click", { ref: "e1" }],
    ["browser_click", { tab: "t1", ref: "12" }],
    ["browser_click", { tab: "t1", ref: "e1; drop" }],
    ["browser_click", { tab: "bad tab", ref: "e1" }],
    ["browser_click", { tab: "t".repeat(200), ref: "e1" }],
    ["browser_click", { tab: 5, ref: "e1" }],
    [
      "browser_type",
      { tab: "t1", ref: "e1", text: "x".repeat(MAX_TYPE_CHARS + 1) },
    ],
    ["browser_type", { tab: "t1", ref: "e1", text: 5 }],
    ["browser_type", { tab: "t1", ref: "e1", text: "a", submit: "yes" }],
    ["browser_select", { tab: "t1", ref: "e1", values: [] }],
    ["browser_select", { tab: "t1", ref: "e1", values: Array(11).fill("a") }],
    ["browser_select", { tab: "t1", ref: "e1", values: [5] }],
    ["browser_scroll", { tab: "t1", direction: "diagonal" }],
    ["browser_scroll", { tab: "t1", direction: "down", amount: 0 }],
    ["browser_scroll", { tab: "t1", direction: "down", amount: 1.5 }],
    ["browser_snapshot", { tab: "t1", maxChars: 10 }],
    ["browser_snapshot", { tab: "t1", maxChars: 100000 }],
    ["browser_read", { tab: "t1", maxChars: 5 }],
    ["browser_open", { url: "x".repeat(9000) }],
    ["browser_open", {}],
    ["browser_upload", { tab: "t1", ref: "e1", uploadId: "../etc/passwd" }],
  ];
  for (const [name, input] of bad) {
    assert.equal(
      validateToolInput(name, input).ok,
      false,
      `${name} ${JSON.stringify(input).slice(0, 80)}`,
    );
  }
});

test("navigate and wait require exactly one selector", () => {
  assert.equal(
    validateToolInput("browser_navigate", {
      tab: "t1",
      url: "https://a.example",
    }).ok,
    true,
  );
  assert.equal(
    validateToolInput("browser_navigate", { tab: "t1", action: "back" }).ok,
    true,
  );
  assert.equal(validateToolInput("browser_navigate", { tab: "t1" }).ok, false);
  assert.equal(
    validateToolInput("browser_navigate", {
      tab: "t1",
      url: "https://a.example",
      action: "back",
    }).ok,
    false,
  );
  assert.equal(
    validateToolInput("browser_navigate", { tab: "t1", action: "stop" }).ok,
    false,
  );
  assert.equal(
    validateToolInput("browser_wait", {
      tab: "t1",
      text: "Done",
      timeoutMs: 5000,
    }).ok,
    true,
  );
  assert.equal(
    validateToolInput("browser_wait", { tab: "t1", idleMs: 500 }).ok,
    true,
  );
  assert.equal(validateToolInput("browser_wait", { tab: "t1" }).ok, false);
  assert.equal(
    validateToolInput("browser_wait", { tab: "t1", text: "a", ref: "e1" }).ok,
    false,
  );
  assert.equal(
    validateToolInput("browser_wait", {
      tab: "t1",
      text: "a",
      timeoutMs: 60_000,
    }).ok,
    false,
  );
});
