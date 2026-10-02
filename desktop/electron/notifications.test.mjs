import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createNativeNotificationHandler,
  ELECTRON_NOTIFICATION_ACTIVATED_EVENT,
} from "./notifications.mjs";

function createHarness({ supported = true } = {}) {
  const created = [];
  const emitted = [];
  const calls = [];
  class TestNotification extends EventEmitter {
    static isSupported() {
      return supported;
    }

    constructor(options) {
      super();
      this.options = options;
      created.push(this);
    }

    show() {
      calls.push(["show"]);
    }
  }
  const showNativeNotification = createNativeNotificationHandler({
    Notification: TestNotification,
    revealWindow: () => calls.push(["reveal"]),
    emit: (event, payload) => emitted.push({ event, payload }),
  });
  return { calls, created, emitted, showNativeNotification };
}

test("shows through Electron and routes a clicked target back to the renderer", async () => {
  const harness = createHarness();
  const target = {
    channelId: "channel-1",
    channelName: "general",
    content: "Hello",
    createdAt: 123,
    eventId: "event-1",
    kind: 40002,
    pubkey: "pubkey-1",
    threadRootId: "root-1",
    untrustedField: "discarded",
  };

  assert.equal(
    await harness.showNativeNotification({
      title: "Message in #general",
      body: "Hello",
      target,
    }),
    null,
  );
  assert.deepEqual(harness.created[0].options, {
    title: "Message in #general",
    body: "Hello",
    silent: true,
  });
  assert.deepEqual(harness.calls, [["show"]]);

  harness.created[0].emit("click");
  assert.deepEqual(harness.calls, [["show"], ["reveal"]]);
  assert.deepEqual(harness.emitted, [
    {
      event: ELECTRON_NOTIFICATION_ACTIVATED_EVENT,
      payload: {
        channelId: "channel-1",
        channelName: "general",
        content: "Hello",
        createdAt: 123,
        eventId: "event-1",
        kind: 40002,
        pubkey: "pubkey-1",
        threadRootId: "root-1",
      },
    },
  ]);
});

test("shows untargeted notifications without installing a click route", async () => {
  const harness = createHarness();
  await harness.showNativeNotification({ title: "Updates are ready" });
  harness.created[0].emit("click");
  assert.deepEqual(harness.calls, [["show"], ["reveal"]]);
  assert.deepEqual(harness.emitted, []);
});

test("reports unsupported notification service and malformed title", async () => {
  await assert.rejects(
    createHarness({ supported: false }).showNativeNotification({
      title: "No notifications",
    }),
    /not supported/,
  );
  await assert.rejects(createHarness().showNativeNotification({ title: "" }), {
    message: "Notification title is required",
  });
});
