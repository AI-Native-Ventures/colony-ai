import assert from "node:assert/strict";
import test from "node:test";
import { revealElectronWindow } from "./window-activation.mjs";

function fakeWindow({ destroyed = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    showInactive: () => calls.push("showInactive"),
    focus: () => calls.push("focus"),
  };
}

test("background reveal shows the window without restoring or focusing it", () => {
  const window = fakeWindow({ minimized: true });

  assert.equal(revealElectronWindow(window, { backgroundMode: true }), true);
  assert.deepEqual(window.calls, ["showInactive"]);
});

test("normal reveal restores, shows, and focuses a minimized window", () => {
  const window = fakeWindow({ minimized: true });

  assert.equal(revealElectronWindow(window), true);
  assert.deepEqual(window.calls, ["restore", "show", "focus"]);
});

test("destroyed windows are left untouched", () => {
  const window = fakeWindow({ destroyed: true });

  assert.equal(revealElectronWindow(window), false);
  assert.deepEqual(window.calls, []);
});
