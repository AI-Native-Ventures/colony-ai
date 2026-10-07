import assert from "node:assert/strict";
import test from "node:test";

import { browserShortcutAction } from "../../../../electron/browser-host-policy.mjs";
import { browserShortcutFromKey } from "./browserShortcuts.ts";

const KEYS = [
  "l",
  "L",
  "t",
  "w",
  "r",
  "[",
  "]",
  "\\",
  "ArrowLeft",
  "ArrowRight",
  "F5",
  "a",
  "Enter",
  "Escape",
];
const PLATFORMS = ["darwin", "win32", "linux"];

test("the renderer and the host map every key combination to the same action", () => {
  let mapped = 0;
  for (const platform of PLATFORMS) {
    for (const key of KEYS) {
      for (let bits = 0; bits < 16; bits += 1) {
        const control = Boolean(bits & 1);
        const meta = Boolean(bits & 2);
        const alt = Boolean(bits & 4);
        const shift = Boolean(bits & 8);
        const host = browserShortcutAction(
          {
            type: "keyDown",
            key,
            control,
            meta,
            alt,
            shift,
            isAutoRepeat: false,
          },
          platform,
        );
        const renderer = browserShortcutFromKey(
          {
            key,
            ctrlKey: control,
            metaKey: meta,
            altKey: alt,
            shiftKey: shift,
          },
          platform === "darwin",
        );
        assert.equal(
          renderer,
          host,
          `${platform} ${key} c${+control} m${+meta} a${+alt} s${+shift}`,
        );
        if (host) mapped += 1;
      }
    }
  }
  assert.ok(
    mapped >= 30,
    `the grid must exercise mapped shortcuts (${mapped})`,
  );
});

test("repeats and IME composition are ignored in the renderer", () => {
  const base = {
    key: "l",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  assert.equal(browserShortcutFromKey(base, false), "focus-address");
  assert.equal(browserShortcutFromKey({ ...base, repeat: true }, false), null);
  assert.equal(
    browserShortcutFromKey({ ...base, isComposing: true }, false),
    null,
  );
});
