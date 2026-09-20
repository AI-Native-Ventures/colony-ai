import assert from "node:assert/strict";
import test from "node:test";

import {
  isExactPayload,
  isTrustedNavigation,
  validateExactIpcCall,
} from "./ipc-security.mjs";

const trustedUrl = "file:///stage0/src-electron/feasibility/index.html";
const webContents = { id: 9 };
const topFrame = { url: trustedUrl };
topFrame.top = topFrame;

function eventFor(frame = topFrame, sender = webContents) {
  return { sender, senderFrame: frame };
}

test("exact IPC payloads reject extra renderer-controlled fields", () => {
  assert.equal(isExactPayload({}, {}), true);
  assert.equal(isExactPayload({ method: "get_default_relay_url" }, {}), false);
  assert.equal(isExactPayload(undefined, {}), false);
});

test("trusted top-frame IPC accepts only the exact packaged origin", () => {
  assert.doesNotThrow(() =>
    validateExactIpcCall({
      event: eventFor(),
      webContents,
      trustedUrl,
      payload: {},
    }),
  );
});

test("sender, subframe, and foreign-origin IPC are denied", () => {
  assert.throws(
    () =>
      validateExactIpcCall({
        event: eventFor(topFrame, { id: 10 }),
        webContents,
        trustedUrl,
        payload: {},
      }),
    (error) => error.code === "invalid_ipc_sender",
  );

  const subframe = { url: trustedUrl };
  subframe.top = topFrame;
  assert.throws(
    () =>
      validateExactIpcCall({
        event: eventFor(subframe),
        webContents,
        trustedUrl,
        payload: {},
      }),
    (error) => error.code === "untrusted_sender",
  );

  const foreignFrame = { url: "https://example.invalid/" };
  foreignFrame.top = foreignFrame;
  assert.throws(
    () =>
      validateExactIpcCall({
        event: eventFor(foreignFrame),
        webContents,
        trustedUrl,
        payload: {},
      }),
    (error) => error.code === "untrusted_origin",
  );
});

test("foreign, subframe, and new-window navigation are not trusted", () => {
  assert.equal(
    isTrustedNavigation({
      candidateUrl: trustedUrl,
      trustedUrl,
      isMainFrame: true,
    }),
    true,
  );
  assert.equal(
    isTrustedNavigation({
      candidateUrl: trustedUrl,
      trustedUrl,
      isMainFrame: false,
    }),
    false,
  );
  assert.equal(
    isTrustedNavigation({
      candidateUrl: "https://example.invalid/",
      trustedUrl,
      isMainFrame: true,
    }),
    false,
  );
});
