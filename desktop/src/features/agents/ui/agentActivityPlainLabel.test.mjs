import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ACTIVITY_DETAIL_LENGTH,
  PLAIN_COMMAND_LABEL,
  PLAIN_FAILED_TOOL_LABEL,
  PLAIN_UNKNOWN_TOOL_LABEL,
  plainActivityLabel,
} from "./agentActivityPlainLabel.ts";

const FORBIDDEN = /buzz|fizz|honey|pollen|\bbee/i;

function shell(command, overrides = {}) {
  return plainActivityLabel({
    title: "Shell",
    toolName: "dev__shell",
    buzzToolName: null,
    args: { command },
    ...overrides,
  });
}

function assertPlain(result) {
  assert.doesNotMatch(result.label, FORBIDDEN, `brand in "${result.label}"`);
  assert.doesNotMatch(result.label, /[|<>&;$`]/, `shell syntax in label`);
  assert.doesNotMatch(result.label, /--|\b[0-9a-f]{8}-[0-9a-f]{4}\b/);
}

const CLI_CASES = [
  // The exact strings from the real run.
  ["buzz --format compact channels list 2>&1 | head -50", "Checking channels"],
  [
    'echo "hi" | buzz messages send --channel dc25bbfd-1111-2222-3333-444455556666 --content -',
    "Sending a message",
  ],
  ["buzz messages send --channel abc --content hello", "Sending a message"],
  ["buzz messages thread --link x", "Reading the conversation"],
  ["buzz messages get --channel abc", "Reading the conversation"],
  ["buzz messages list --channel abc", "Reading the conversation"],
  ["buzz messages search --query tax", "Searching"],
  ["buzz channels search --query tax", "Searching"],
  ["buzz channels get --channel abc", "Checking channels"],
  ["buzz channels create --name ops", "Updating a channel"],
  ["buzz canvas get --channel abc", "Reading the canvas"],
  ["buzz canvas set --channel abc", "Updating the canvas"],
  ["buzz feed get", "Checking the feed"],
  ["buzz users get --name a", "Looking up people"],
  ["buzz reactions add --event e", "Reacting to a message"],
  ["buzz workflows list", "Checking workflows"],
  ["buzz upload --file a.png", null],
  ["/usr/local/bin/buzz channels list", "Checking channels"],
];

// Agents are taught the `colony` command now; `buzz` stays valid for older
// agents and saved transcripts. Every spelling above must map identically.
const COLONY_CLI_CASES = [
  // The exact string from the real run, with the new command name.
  [
    "colony --format compact channels list 2>&1 | head -50",
    "Checking channels",
  ],
  ["/Users/someone/.colony/bin/colony channels list", "Checking channels"],
  ...CLI_CASES.map(([command, expected]) => [
    command.replace(/\bbuzz\b/g, "colony"),
    expected,
  ]),
];

for (const [command, expected] of [...CLI_CASES, ...COLONY_CLI_CASES]) {
  if (expected === null) continue;
  test(`agent CLI "${command.slice(0, 40)}" maps to "${expected}"`, () => {
    const result = shell(command);
    assert.equal(result.label, expected);
    assert.equal(result.hasRawCommand, true);
    assertPlain(result);
  });
}

test("a command still maps when the harness names the tool something unknown", () => {
  // Real run: the tool was not recognised as a shell tool, so it used to fall
  // through to "Ran tool" with the raw line as its preview.
  const result = plainActivityLabel({
    title: "Run command",
    toolName: "mystery",
    buzzToolName: null,
    args: { command: "buzz --format compact channels list 2>&1 | head -50" },
  });
  assert.equal(result.label, "Checking channels");
  assert.equal(
    result.detail,
    "buzz --format compact channels list 2>&1 | head -50",
  );
});

test("a colony command still maps when the harness names the tool something unknown", () => {
  const command = "colony --format compact channels list 2>&1 | head -50";
  const result = plainActivityLabel({
    title: "Run command",
    toolName: "mystery",
    buzzToolName: null,
    args: { command },
  });
  assert.equal(result.label, "Checking channels");
  assert.equal(result.detail, command);
  assert.equal(result.hasRawCommand, true);
  assertPlain(result);
});

test("non-CLI shell commands become a neutral running-a-command label", () => {
  for (const command of ["ls -la | head", "cat notes.txt", "git status"]) {
    const result = shell(command);
    assert.equal(result.label, PLAIN_COMMAND_LABEL);
    assert.equal(result.detail, command);
    assertPlain(result);
  }
});

test("unknown CLI group falls back to running a command", () => {
  assert.equal(shell("buzz nonsense go").label, PLAIN_COMMAND_LABEL);
  assert.equal(shell("colony nonsense go").label, PLAIN_COMMAND_LABEL);
});

test("a colony folder in a path is not mistaken for the command", () => {
  for (const command of [
    "ls -la ~/.colony",
    "cat ~/.colony/notes.md",
    "cd ~/Projects/colony && ls -la",
    "colony",
    "colony --help",
  ]) {
    const result = shell(command);
    assert.equal(result.label, PLAIN_COMMAND_LABEL, command);
    assert.equal(result.detail, command);
    assertPlain(result);
  }
});

test("relay tools without a command map by name", () => {
  const cases = [
    ["send_message", "Sending a message"],
    ["get_messages", "Reading the conversation"],
    ["get_thread", "Reading the conversation"],
    ["get_channel_history", "Reading the conversation"],
    ["search", "Searching"],
    ["list_channels", "Checking channels"],
    ["get_channel", "Checking channels"],
  ];
  for (const [name, expected] of cases) {
    const result = plainActivityLabel({
      title: name,
      toolName: name,
      buzzToolName: name,
      args: { channel_id: "abc" },
    });
    assert.equal(result.label, expected, name);
    assert.equal(result.hasRawCommand, false);
    assertPlain(result);
  }
});

test("other known relay tools get a generic read or update label", () => {
  const read = plainActivityLabel({
    title: "get_presence",
    toolName: "get_presence",
    buzzToolName: "get_presence",
    args: {},
  });
  assert.equal(read.label, "Looking something up");
  const write = plainActivityLabel({
    title: "set_presence",
    toolName: "set_presence",
    buzzToolName: "set_presence",
    args: {},
  });
  assert.equal(write.label, "Making an update");
});

test("file tools map to reading and writing a file", () => {
  const read = plainActivityLabel({
    title: "Read File",
    toolName: "dev__read_file",
    buzzToolName: null,
    args: { path: "/work/buzz/notes.md" },
  });
  assert.equal(read.label, "Reading a file");
  assert.equal(read.detail, "/work/buzz/notes.md");
  assert.equal(read.hasRawCommand, false);
  assertPlain(read);

  for (const toolName of ["dev__str_replace", "write_file", "Edit"]) {
    const write = plainActivityLabel({
      title: toolName,
      toolName,
      buzzToolName: null,
      args: { path: "src/a.ts" },
    });
    assert.equal(write.label, "Writing a file", toolName);
  }
});

test("search style tools map to searching", () => {
  assert.equal(
    plainActivityLabel({
      title: "Grep",
      toolName: "Grep",
      buzzToolName: null,
      args: { pattern: "x" },
    }).label,
    "Searching",
  );
});

test("unknown tools use the neutral label", () => {
  const result = plainActivityLabel({
    title: "Frobnicate",
    toolName: "frobnicate",
    buzzToolName: null,
    args: { widget: 1 },
  });
  assert.equal(result.label, PLAIN_UNKNOWN_TOOL_LABEL);
  assert.equal(result.detail, null);
  assertPlain(result);
});

test("empty input does not throw and is neutral", () => {
  for (const input of [
    {},
    { args: null },
    { title: "", toolName: "", buzzToolName: null, args: {} },
    { args: { command: "   " } },
  ]) {
    const result = plainActivityLabel(input);
    assert.equal(result.label, PLAIN_UNKNOWN_TOOL_LABEL);
    assert.equal(result.detail, null);
    assert.equal(result.hasRawCommand, false);
  }
});

test("failed calls say so without raw text", () => {
  const known = shell("buzz messages send --content hi", { isError: true });
  assert.equal(known.label, "Sending a message failed");
  const unknown = plainActivityLabel({
    title: "Frobnicate",
    toolName: "frobnicate",
    buzzToolName: null,
    args: {},
    isError: true,
  });
  assert.equal(unknown.label, PLAIN_FAILED_TOOL_LABEL);
  assertPlain(known);
  assertPlain(unknown);
});

test("very long commands keep a fixed label and a bounded detail", () => {
  const filler = "x".repeat(200_000);
  const long = shell(`echo ${filler} | buzz messages send --content -`);
  assert.equal(long.label, "Sending a message");
  assert.ok(long.detail.length <= MAX_ACTIVITY_DETAIL_LENGTH + 1);
  assert.ok(long.detail.endsWith("…"));
  assertPlain(long);

  const longUnknown = shell(filler);
  assert.equal(longUnknown.label, PLAIN_COMMAND_LABEL);
  assert.ok(longUnknown.detail.length <= MAX_ACTIVITY_DETAIL_LENGTH + 1);
});

test("labels never carry the raw command or its name, for either spelling", () => {
  for (const name of ["buzz", "colony"]) {
    const commands = [
      `${name} --format compact channels list 2>&1 | head -50`,
      `${name} mem get core`,
      `echo hi | ${name} messages send --channel abc --content -`,
      `/Users/someone/.${name}/bin/${name} dms list`,
      `${name} nonsense go`,
    ];
    for (const command of commands) {
      const result = shell(command);
      assertPlain(result);
      assert.doesNotMatch(
        result.label,
        /colony/i,
        `command name in "${result.label}"`,
      );
      assert.doesNotMatch(
        result.label,
        /\/|~|\.colony|\.buzz/,
        `path in "${result.label}"`,
      );
      assert.equal(result.hasRawCommand, true);
      assert.equal(result.detail, command);
    }
  }
});

test("labels never carry the legacy product words, whatever the input", () => {
  const inputs = [
    "buzz channels list",
    "Buzz messages send",
    "echo fizz honey pollen bee | buzz feed get",
    "buzz   --format   compact   dms   list",
    "buzz messages send --content 'fizz | honey'",
    "colony channels list",
    "echo fizz honey pollen bee | colony feed get",
    "colony   --format   compact   dms   list",
  ];
  for (const command of inputs) {
    assertPlain(shell(command));
  }
});
