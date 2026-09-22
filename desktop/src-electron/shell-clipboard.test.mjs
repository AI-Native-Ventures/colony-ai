import assert from "node:assert/strict";
import test from "node:test";

import {
  copyTextToClipboard,
  createShellClipboardIpc,
  readClipboardText,
  SHELL_CLIPBOARD_CAPABILITY,
  SHELL_CLIPBOARD_METHODS,
  validateCopyTextArgs,
} from "./shell-clipboard.mjs";

function fakeClipboard({ text = "", onWrite, onRead, failWith } = {}) {
  let stored = text;
  const calls = [];
  return {
    calls,
    get stored() {
      return stored;
    },
    writeText(value) {
      calls.push(["writeText", value]);
      if (failWith) throw failWith;
      if (onWrite) onWrite(value);
      stored = value;
    },
    write(value) {
      calls.push(["write", value]);
      if (failWith) throw failWith;
      if (onWrite) onWrite(value);
      stored = value.text;
    },
    readText() {
      calls.push(["readText"]);
      if (failWith) throw failWith;
      if (onRead) return onRead();
      return stored;
    },
  };
}

test("text-only write selects writeText and returns a frozen ok", () => {
  const clipboard = fakeClipboard();
  const result = copyTextToClipboard({ text: "hello" }, clipboard);
  assert.deepEqual(result, { ok: true });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(clipboard.calls, [["writeText", "hello"]]);
  assert.equal(clipboard.stored, "hello");
});

test("html write selects write({ text, html }) like upstream set_html", () => {
  const clipboard = fakeClipboard();
  const result = copyTextToClipboard(
    { text: "hello", html: "<b>hello</b>" },
    clipboard,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(clipboard.calls, [
    ["write", { text: "hello", html: "<b>hello</b>" }],
  ]);
});

test("read returns frozen { ok, text }, including empty string", () => {
  const clipboard = fakeClipboard({ text: "" });
  const empty = readClipboardText(clipboard);
  assert.deepEqual(empty, { ok: true, text: "" });
  assert.ok(Object.isFrozen(empty));
  const filled = readClipboardText(fakeClipboard({ text: "abc" }));
  assert.deepEqual(filled, { ok: true, text: "abc" });
});

test("backend failures keep the upstream clipboard error prefix", () => {
  const failure = new Error("denied by OS");
  assert.throws(
    () =>
      copyTextToClipboard({ text: "x" }, fakeClipboard({ failWith: failure })),
    /^Error: clipboard error: denied by OS$/,
  );
  assert.throws(
    () => readClipboardText(fakeClipboard({ failWith: failure })),
    /^Error: clipboard error: denied by OS$/,
  );
});

test("already-prefixed backend errors are not double-prefixed", () => {
  const prefixed = new Error("clipboard error: boom");
  assert.throws(
    () => readClipboardText(fakeClipboard({ failWith: prefixed })),
    /^Error: clipboard error: boom$/,
  );
});

test("missing backend or missing method fails with the clipboard prefix", () => {
  assert.throws(
    () => copyTextToClipboard({ text: "x" }, null),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
  assert.throws(
    () => readClipboardText({}),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
  assert.throws(
    () =>
      copyTextToClipboard({ text: "x", html: "<b>x</b>" }, { writeText() {} }),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
});

test("non-string backend read result is a clipboard error, not a crash", () => {
  assert.throws(
    () => readClipboardText({ readText: () => 42 }),
    /^Error: clipboard error: clipboard backend returned non-string text$/,
  );
});

test("invalid payloads throw invalid_payload without touching the backend", () => {
  const bad = [
    null,
    undefined,
    "text",
    [],
    {},
    { html: "<b>x</b>" },
    { text: 42 },
    { text: "x", html: 42 },
    { text: "x", extra: 1 },
  ];
  for (const args of bad) {
    const clipboard = fakeClipboard();
    assert.throws(() => validateCopyTextArgs(args), /^Error: invalid_payload$/);
    assert.throws(
      () => copyTextToClipboard(args, clipboard),
      /^Error: invalid_payload$/,
    );
    assert.deepEqual(clipboard.calls, []);
  }
});

test("validate normalises absent html to null", () => {
  assert.deepEqual(validateCopyTextArgs({ text: "x" }), {
    text: "x",
    html: null,
  });
  const validated = validateCopyTextArgs({ text: "x", html: "<i>x</i>" });
  assert.ok(Object.isFrozen(validated));
});

test("ipc descriptor names the upstream commands and delegates", () => {
  const clipboard = fakeClipboard();
  const ipc = createShellClipboardIpc({ clipboard });
  assert.equal(ipc.capability, SHELL_CLIPBOARD_CAPABILITY);
  assert.deepEqual(Object.keys(ipc.methods).sort(), [
    SHELL_CLIPBOARD_METHODS.COPY_TEXT,
    SHELL_CLIPBOARD_METHODS.READ_TEXT,
  ]);
  assert.equal(SHELL_CLIPBOARD_METHODS.COPY_TEXT, "copy_text_to_clipboard");
  assert.equal(SHELL_CLIPBOARD_METHODS.READ_TEXT, "read_clipboard_text");
  assert.ok(Object.isFrozen(ipc));
  assert.deepEqual(ipc.methods.copy_text_to_clipboard({ text: "hi" }), {
    ok: true,
  });
  assert.deepEqual(ipc.methods.read_clipboard_text(), { ok: true, text: "hi" });
  assert.throws(
    () => createShellClipboardIpc({ clipboard: null }),
    /^Error: invalid_payload$/,
  );
});
