import assert from "node:assert/strict";
import test from "node:test";

const previousWindow = globalThis.window;
globalThis.window = new EventTarget();
const { createElectronTauriInternals } = await import("./electronTauriShim.ts");
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

test("Electron notification activation reaches the existing notification action listener", () => {
  const previousWindow = globalThis.window;
  const window = new EventTarget();
  globalThis.window = window;
  const messages = [];
  const bridge = {
    platform: "darwin",
    subscribe: (callback) => messages.push(callback),
    request: async () => undefined,
  };
  const { internals } = createElectronTauriInternals(bridge);
  const received = [];
  window.addEventListener("buzz:desktop-notification-action", (event) => {
    received.push(event.detail);
  });

  try {
    messages[0]({
      type: "shell-event",
      event: "electron-shell:notification-activated",
      payload: { channelId: "channel-1", eventId: "event-1" },
    });
    assert.deepEqual(received, [
      { channelId: "channel-1", eventId: "event-1" },
    ]);

    messages[0]({
      type: "shell-event",
      event: "tauri://resize",
      payload: { width: 800, height: 600 },
    });
    assert.equal(received.length, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.equal(typeof internals.invoke, "function");
});
