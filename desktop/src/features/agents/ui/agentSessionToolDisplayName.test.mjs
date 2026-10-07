import assert from "node:assert/strict";
import test from "node:test";

import { plainActivityLabel } from "./agentActivityPlainLabel.ts";
import {
  formatToolTitle,
  PLAIN_UNKNOWN_TOOL_TITLE,
  plainifyToolIds,
} from "./agentSessionToolCatalog.ts";
import { buildCompactToolSummary } from "./agentSessionToolSummary.ts";
import { buildTranscript } from "./agentSessionTranscript.ts";

// The five ids the bundled runtime exposes, plus an unknown MCP id.
const DEV_TOOLS = [
  ["buzz-dev-mcp__shell", "Run a command", { command: "ls -la" }],
  ["buzz-dev-mcp__read_file", "Read a file", { path: "/tmp/notes.txt" }],
  ["buzz-dev-mcp__str_replace", "Edit a file", { path: "/tmp/notes.txt" }],
  ["buzz-dev-mcp__todo", "Update the to-do list", {}],
  ["buzz-dev-mcp__view_image", "View an image", { source: "/tmp/a.png" }],
];
const UNKNOWN_TOOL = "acme-crm__lookup_contact";

/** What a person can see or hear by default must never carry the old name. */
const FORBIDDEN = /buzz|__|dev[-_]mcp|acme-crm/i;

function assertPlain(text, where) {
  assert.doesNotMatch(String(text), FORBIDDEN, `${where}: "${text}"`);
}

const baseEvent = {
  seq: 1,
  timestamp: "2026-10-07T00:00:00Z",
  kind: "acp_read",
  agentIndex: 0,
  channelId: "11111111-1111-1111-1111-111111111111",
  sessionId: "sess-1",
  turnId: "turn-1",
};

function permissionEvent(seq, id, title) {
  return {
    ...baseEvent,
    seq,
    turnId: `turn-${seq}`,
    payload: {
      method: "session/request_permission",
      id,
      params: {
        title,
        toolCallId: `call-${seq}`,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    },
  };
}

function toolCallEvent(seq, update) {
  return {
    ...baseEvent,
    seq,
    payload: {
      method: "session/update",
      params: { sessionId: baseEvent.sessionId, update },
    },
  };
}

test("formatToolTitle turns every runtime tool id into plain words", () => {
  for (const [id, plain] of DEV_TOOLS) {
    assert.equal(formatToolTitle(id), plain);
    // Also after the transcript's own id normalisation, and as a bare name.
    const bare = id.split("__")[1];
    assert.equal(formatToolTitle(bare), plain);
    assert.equal(formatToolTitle(`dev_mcp_${bare}`), plain);
    assertPlain(formatToolTitle(id, id), id);
  }
});

test("formatToolTitle never shows a server prefix for an unknown MCP id", () => {
  assert.equal(formatToolTitle(UNKNOWN_TOOL), PLAIN_UNKNOWN_TOOL_TITLE);
  assert.equal(PLAIN_UNKNOWN_TOOL_TITLE, "Use a tool");
  assert.equal(
    formatToolTitle("tool_call", UNKNOWN_TOOL),
    PLAIN_UNKNOWN_TOOL_TITLE,
  );
  assert.equal(formatToolTitle("buzz-other__thing"), "Use a tool");
});

test("formatToolTitle keeps a human title and relay tool names as before", () => {
  assert.equal(formatToolTitle("get_feed"), "Get Feed");
  assert.equal(
    formatToolTitle("tool_call", "Read the manual"),
    "Read the manual",
  );
});

test("plainifyToolIds rewrites ids inside a sentence", () => {
  assert.equal(
    plainifyToolIds("Allow buzz-dev-mcp__shell to run?"),
    "Allow Run a command to run?",
  );
  assert.equal(plainifyToolIds("Nothing raw here"), "Nothing raw here");
});

test("permission rows and live announcements say plain words only", () => {
  const events = [...DEV_TOOLS.map(([id]) => id), UNKNOWN_TOOL].map(
    (id, index) => permissionEvent(10 + index, 100 + index, id),
  );
  const items = buildTranscript(events).filter(
    (item) => item.type === "lifecycle" && item.renderClass === "permission",
  );
  assert.equal(items.length, 6);
  const expected = [...DEV_TOOLS.map(([, plain]) => plain), "Use a tool"];
  items.forEach((item, index) => {
    // The log region announces title + text, so these are the live strings.
    assertPlain(item.title, "title");
    assertPlain(item.text, "text");
    assertPlain(item.descriptor.label, "descriptor.label");
    assertPlain(item.descriptor.preview, "descriptor.preview");
    assertPlain(item.descriptor.action.object, "descriptor.action.object");
    assert.equal(item.title, "Permission requested");
    assert.match(item.text, new RegExp(expected[index]));
    // The raw id is not lost: it stays on the descriptor for opt-in use.
    assert.match(item.descriptor.object, /__/);
  });
});

test("permission rows sanitise ids embedded in a longer request title", () => {
  const [item] = buildTranscript([
    permissionEvent(20, 200, "Allow buzz-dev-mcp__shell to run a command?"),
  ]).filter((entry) => entry.type === "lifecycle");
  assertPlain(item.text, "text");
  assert.match(item.text, /Allow Run a command to run a command\?/);
});

test("tool rows show plain wording for the runtime tools and an unknown MCP id", () => {
  for (const [id, , args] of [
    ...DEV_TOOLS,
    [UNKNOWN_TOOL, "Use a tool", { query: "ada" }],
  ]) {
    const [item] = buildTranscript([
      toolCallEvent(30, {
        sessionUpdate: "tool_call",
        toolCallId: "call-x",
        status: "completed",
        title: id,
        toolName: id,
        rawInput: args,
      }),
    ]).filter((entry) => entry.type === "tool");
    assert.ok(item, id);
    const summary = buildCompactToolSummary(item);
    assertPlain(summary.label, `${id} label`);
    assertPlain(plainActivityLabel(item).label, `${id} plain label`);
    if (id === UNKNOWN_TOOL) {
      assertPlain(summary.preview, `${id} preview`);
    }
    // The stored tool name still carries the raw id for opt-in details.
    assert.match(item.toolName + item.title, /mcp|acme/i);
  }
});

test("a tool call with no arguments yet cannot leak its title as a preview", () => {
  const [item] = buildTranscript([
    toolCallEvent(40, {
      sessionUpdate: "tool_call",
      toolCallId: "call-y",
      status: "executing",
      title: UNKNOWN_TOOL,
      toolName: UNKNOWN_TOOL,
      rawInput: {},
    }),
  ]).filter((entry) => entry.type === "tool");
  const summary = buildCompactToolSummary(item);
  assertPlain(summary.preview ?? "", "preview");
  assertPlain(summary.action?.object ?? "", "action.object");
});
