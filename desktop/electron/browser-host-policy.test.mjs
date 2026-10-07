import assert from "node:assert/strict";
import test from "node:test";
import {
  browserShortcutAction,
  numberedDownloadName,
  safeDownloadName,
} from "./browser-host-policy.mjs";

const key = (overrides) => ({
  type: "keyDown",
  key: "",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...overrides,
});

test("download names are bare, bounded and not machine-suffixed", () => {
  assert.equal(safeDownloadName("report.pdf"), "report.pdf");
  assert.equal(safeDownloadName("../../etc/passwd"), "passwd");
  assert.equal(safeDownloadName("..\\..\\win\\evil.exe"), "evil.exe");
  assert.equal(safeDownloadName(".hidden"), "hidden");
  assert.equal(safeDownloadName(""), "download");
  assert.equal(safeDownloadName("..."), "download");
  assert.equal(safeDownloadName('a/b/c<>:"|?*.txt'), "c_______.txt");
  assert.ok(safeDownloadName(`${"x".repeat(500)}.pdf`).length <= 124);
  assert.equal(numberedDownloadName("a.tar.gz", 0), "a.tar.gz");
  assert.equal(numberedDownloadName("a.pdf", 2), "a (2).pdf");
  assert.equal(numberedDownloadName("noext", 1), "noext (1)");
});

test("page shortcuts map to app actions with the right modifier per platform", () => {
  const cases = [
    [{ key: "l" }, "focus-address"],
    [{ key: "t" }, "new-tab"],
    [{ key: "w" }, "close-tab"],
    [{ key: "r" }, "reload"],
    [{ key: "[" }, "back"],
    [{ key: "]" }, "forward"],
    [{ key: "\\" }, "toggle-dock"],
  ];
  for (const [input, action] of cases) {
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true }), "darwin"),
      action,
      `darwin ${input.key}`,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "linux"),
      action,
      `linux ${input.key}`,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "win32"),
      action,
      `win32 ${input.key}`,
    );
    // The other platform's modifier, Shift and Alt are not these shortcuts.
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "darwin"),
      null,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true }), "linux"),
      null,
    );
    assert.equal(
      browserShortcutAction(
        key({ ...input, meta: true, shift: true }),
        "darwin",
      ),
      null,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true, alt: true }), "darwin"),
      null,
    );
  }
  assert.equal(
    browserShortcutAction(key({ key: "L", meta: true }), "darwin"),
    "focus-address",
  );
});

test("history and reload keys that need no primary modifier", () => {
  assert.equal(
    browserShortcutAction(key({ key: "ArrowLeft", alt: true }), "linux"),
    "back",
  );
  assert.equal(
    browserShortcutAction(key({ key: "ArrowRight", alt: true }), "win32"),
    "forward",
  );
  // Option+Arrow is word movement in a macOS text field: never history there.
  assert.equal(
    browserShortcutAction(key({ key: "ArrowLeft", alt: true }), "darwin"),
    null,
  );
  assert.equal(
    browserShortcutAction(key({ key: "ArrowRight", alt: true }), "darwin"),
    null,
  );
  assert.equal(browserShortcutAction(key({ key: "F5" }), "linux"), "reload");
  assert.equal(browserShortcutAction(key({ key: "ArrowLeft" }), "linux"), null);
  assert.equal(
    browserShortcutAction(key({ key: "F5", shift: true }), "linux"),
    null,
  );
});

test("ignores key-up, auto-repeat, plain typing and malformed input", () => {
  assert.equal(
    browserShortcutAction(
      key({ type: "keyUp", key: "l", meta: true }),
      "darwin",
    ),
    null,
  );
  assert.equal(
    browserShortcutAction(
      key({ key: "l", meta: true, isAutoRepeat: true }),
      "darwin",
    ),
    null,
  );
  assert.equal(browserShortcutAction(key({ key: "l" }), "darwin"), null);
  assert.equal(
    browserShortcutAction(key({ key: "a", meta: true }), "darwin"),
    null,
  );
  assert.equal(browserShortcutAction(null, "darwin"), null);
  assert.equal(browserShortcutAction("l", "darwin"), null);
  assert.equal(
    browserShortcutAction(key({ key: undefined, meta: true }), "darwin"),
    null,
  );
});
