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

// Async fake backend mirroring Electron 44's promise-based clipboard:
// readText(): Promise<string>, writeText(text): Promise<void>,
// write([ClipboardItem]): Promise<void>.
function fakeClipboard({ text = "", onWrite, onRead, failWith } = {}) {
  let stored = text;
  const calls = [];
  return {
    calls,
    get stored() {
      return stored;
    },
    async writeText(value) {
      calls.push(["writeText", value]);
      if (failWith) throw failWith;
      if (onWrite) onWrite(value);
      stored = value;
    },
    async write(items) {
      calls.push(["write", items]);
      if (failWith) throw failWith;
      if (onWrite) onWrite(items);
      const record = items?.[0]?.record;
      stored = record?.["text/plain"] ?? valueText(items);
    },
    async readText() {
      calls.push(["readText"]);
      if (failWith) throw failWith;
      if (onRead) return onRead();
      return stored;
    },
  };
}

function valueText(items) {
  return items?.[0]?.text ?? "";
}

// Injected ClipboardItem factory shape: { create: (record) => item }.
// The fake item carries the record so the fake backend can store it.
const fakeClipboardItem = {
  create(record) {
    return { record };
  },
};

test("text-only write selects writeText and returns a frozen ok", async () => {
  const clipboard = fakeClipboard();
  const result = await copyTextToClipboard({ text: "hello" }, clipboard);
  assert.deepEqual(result, { ok: true });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(clipboard.calls, [["writeText", "hello"]]);
  assert.equal(clipboard.stored, "hello");
});

test("html write selects a single atomic ClipboardItem with both MIME types", async () => {
  const clipboard = fakeClipboard();
  const result = await copyTextToClipboard(
    { text: "hello", html: "<b>hello</b>" },
    clipboard,
    fakeClipboardItem,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(clipboard.calls.length, 1);
  assert.equal(clipboard.calls[0][0], "write");
  const items = clipboard.calls[0][1];
  assert.ok(Array.isArray(items) && items.length === 1);
  assert.deepEqual(items[0].record, {
    "text/plain": "hello",
    "text/html": "<b>hello</b>",
  });
  assert.equal(clipboard.stored, "hello");
});

test("html write without an item factory fails with the clipboard prefix", async () => {
  const clipboard = fakeClipboard();
  await assert.rejects(
    copyTextToClipboard({ text: "x", html: "<b>x</b>" }, clipboard),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
  await assert.rejects(
    copyTextToClipboard({ text: "x", html: "<b>x</b>" }, clipboard, {
      create: "not-a-function",
    }),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
});

test("read returns frozen { ok, text }, including empty string", async () => {
  const clipboard = fakeClipboard({ text: "" });
  const empty = await readClipboardText(clipboard);
  assert.deepEqual(empty, { ok: true, text: "" });
  assert.ok(Object.isFrozen(empty));
  const filled = await readClipboardText(fakeClipboard({ text: "abc" }));
  assert.deepEqual(filled, { ok: true, text: "abc" });
});

test("backend failures keep the upstream clipboard error prefix", async () => {
  const failure = new Error("denied by OS");
  await assert.rejects(
    copyTextToClipboard({ text: "x" }, fakeClipboard({ failWith: failure })),
    /^Error: clipboard error: denied by OS$/,
  );
  await assert.rejects(
    readClipboardText(fakeClipboard({ failWith: failure })),
    /^Error: clipboard error: denied by OS$/,
  );
});

test("already-prefixed backend errors are not double-prefixed", async () => {
  const prefixed = new Error("clipboard error: boom");
  await assert.rejects(
    readClipboardText(fakeClipboard({ failWith: prefixed })),
    /^Error: clipboard error: boom$/,
  );
});

test("missing backend or missing method fails with the clipboard prefix", async () => {
  await assert.rejects(
    copyTextToClipboard({ text: "x" }, null),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
  await assert.rejects(
    readClipboardText({}),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
  await assert.rejects(
    copyTextToClipboard(
      { text: "x", html: "<b>x</b>" },
      { writeText() {} },
      fakeClipboardItem,
    ),
    /^Error: clipboard error: clipboard backend unavailable$/,
  );
});

test("non-string backend read result is a clipboard error, not a crash", async () => {
  await assert.rejects(
    readClipboardText({ readText: async () => 42 }),
    /^Error: clipboard error: clipboard backend returned non-string text$/,
  );
});

test("invalid payloads throw invalid_payload without touching the backend", async () => {
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
    await assert.rejects(
      copyTextToClipboard(args, clipboard),
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

test("ipc descriptor names the upstream commands and delegates", async () => {
  const clipboard = fakeClipboard();
  const ipc = createShellClipboardIpc({
    clipboard,
    clipboardItem: fakeClipboardItem,
  });
  assert.equal(ipc.capability, SHELL_CLIPBOARD_CAPABILITY);
  assert.deepEqual(Object.keys(ipc.methods).sort(), [
    SHELL_CLIPBOARD_METHODS.COPY_TEXT,
    SHELL_CLIPBOARD_METHODS.READ_TEXT,
  ]);
  assert.equal(SHELL_CLIPBOARD_METHODS.COPY_TEXT, "copy_text_to_clipboard");
  assert.equal(SHELL_CLIPBOARD_METHODS.READ_TEXT, "read_clipboard_text");
  assert.ok(Object.isFrozen(ipc));
  assert.deepEqual(await ipc.methods.copy_text_to_clipboard({ text: "hi" }), {
    ok: true,
  });
  assert.deepEqual(await ipc.methods.read_clipboard_text(), {
    ok: true,
    text: "hi",
  });
  assert.deepEqual(
    await ipc.methods.copy_text_to_clipboard({
      text: "hi",
      html: "<b>hi</b>",
    }),
    { ok: true },
  );
  assert.throws(
    () => createShellClipboardIpc({ clipboard: null }),
    /^Error: invalid_payload$/,
  );
});
