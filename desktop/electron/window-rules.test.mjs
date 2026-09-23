import assert from "node:assert/strict";
import test from "node:test";

import { applyWindowAction, validWindowLabel } from "./window-rules.mjs";

test("window labels match Tauri's main and huddle-<uuid> forms only", () => {
  assert.ok(validWindowLabel("main"));
  assert.ok(validWindowLabel("huddle-11111111-2222-4333-8444-555555555555"));
  assert.ok(!validWindowLabel("huddle-../../x"));
  assert.ok(!validWindowLabel("settings"));
});

test("title-bar actions map to the Electron window operations", () => {
  const calls = [];
  let maximized = false;
  const window = {
    minimize: () => calls.push("minimize"),
    isMaximized: () => maximized,
    maximize: () => calls.push("maximize"),
    unmaximize: () => calls.push("unmaximize"),
    getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }),
    setBounds: (bounds) => calls.push(["setBounds", bounds]),
  };
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const screen = { getDisplayMatching: () => ({ workArea }) };
  applyWindowAction(window, "minimize", screen);
  applyWindowAction(window, "toggle-maximize", screen);
  maximized = true;
  applyWindowAction(window, "toggle-maximize", screen);
  applyWindowAction(window, "fill-work-area", screen);
  applyWindowAction(window, "unknown", screen);
  assert.deepEqual(calls, [
    "minimize",
    "maximize",
    "unmaximize",
    ["setBounds", workArea],
  ]);
});
