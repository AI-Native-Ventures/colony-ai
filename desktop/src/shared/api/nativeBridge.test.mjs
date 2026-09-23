import assert from "node:assert/strict";
import test from "node:test";

import {
  detectNativeShell,
  getNativeIdentity,
  getSharedIdentity,
  supportsNativeCapability,
} from "./nativeBridge.ts";

const originalWindow = globalThis.window;
const originalIsTauri = globalThis.isTauri;

test.afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalIsTauri === undefined) delete globalThis.isTauri;
  else globalThis.isTauri = originalIsTauri;
});

test("Electron shim exposes the full Tauri identity command path", async () => {
  const calls = [];
  delete globalThis.isTauri;
  globalThis.window = {
    colonyDesktop: {
      platform: "darwin",
      request: async (type, payload) => {
        calls.push([type, payload]);
        if (type !== "invoke") throw new Error(`unexpected request: ${type}`);
        if (payload.command === "is_shared_identity") return true;
        if (payload.command === "get_identity") {
          return {
            display_name: "Electron identity",
            pubkey: "a".repeat(64),
            storage: "system-keyring",
          };
        }
        throw new Error(`unexpected command: ${payload.command}`);
      },
      subscribe: () => () => {},
    },
  };

  await import("./electronTauriShim.ts");

  assert.equal(globalThis.window.isTauri, true);
  assert.equal(detectNativeShell(), "tauri");
  assert.equal(supportsNativeCapability("identity-export"), true);
  assert.equal(await getSharedIdentity(), true);
  assert.deepEqual(await getNativeIdentity(), {
    displayName: "Electron identity",
    locked: false,
    lost: false,
    pubkey: "a".repeat(64),
    resetFailed: false,
    storage: "system-keyring",
  });
  assert.deepEqual(
    calls.map(([type, payload]) => [type, payload.command]),
    [
      ["invoke", "is_shared_identity"],
      ["invoke", "get_identity"],
    ],
  );
});

test("Tauri internals still identify the full native command boundary", async () => {
  const calls = [];
  delete globalThis.isTauri;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        if (command === "is_shared_identity") return false;
        return {
          display_name: "Tauri identity",
          pubkey: "b".repeat(64),
          storage: "local-file",
        };
      },
    },
  };

  assert.equal(detectNativeShell(), "tauri");
  assert.equal(supportsNativeCapability("identity-backup"), true);
  assert.equal(await getSharedIdentity(), false);
  assert.equal((await getNativeIdentity()).pubkey, "b".repeat(64));
  assert.deepEqual(
    calls.map(([command]) => command),
    ["is_shared_identity", "get_identity"],
  );
});

test("web does not select the native command boundary from a legacy bridge", async () => {
  delete globalThis.isTauri;
  globalThis.window = { stage0: { identity: {} } };

  assert.equal(detectNativeShell(), "web");
  assert.equal(supportsNativeCapability("identity-read"), false);
  await assert.rejects(
    getSharedIdentity,
    /native identity bridge is unavailable/,
  );
});
