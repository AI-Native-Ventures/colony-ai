import assert from "node:assert/strict";
import test from "node:test";

import {
  listenForWorkAreaTabRequests,
  requestWorkAreaTab,
} from "./workAreaRequests.ts";

test("tab requests keep legacy kind events and accept contact options", () => {
  const previousWindow = globalThis.window;
  const target = new EventTarget();
  const received = [];
  globalThis.window = target;
  try {
    const unsubscribe = listenForWorkAreaTabRequests((kind, options) => {
      received.push([kind, options]);
    });
    target.dispatchEvent(
      new CustomEvent("colony:open-work-area-tab", { detail: "canvas" }),
    );
    requestWorkAreaTab("whatsapp", { contactWaId: "27821234410" });
    target.dispatchEvent(
      new CustomEvent("colony:open-work-area-tab", {
        detail: { kind: "not-a-tab" },
      }),
    );
    unsubscribe();

    assert.deepEqual(received, [
      ["canvas", undefined],
      ["whatsapp", { contactWaId: "27821234410" }],
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});
