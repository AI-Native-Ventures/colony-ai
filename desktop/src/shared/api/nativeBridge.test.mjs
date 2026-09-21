import assert from "node:assert/strict";
import test from "node:test";

import {
  detectNativeShell,
  getNativeIdentity,
  getSharedIdentity,
  normalizeElectronIdentity,
  normalizeElectronSharedIdentity,
  supportsNativeCapability,
} from "./nativeBridge.ts";
import { resolveInitialMachineOnboardingState } from "@/features/onboarding/ui/machineOnboardingStartup.ts";

const originalWindow = globalThis.window;
const originalIsTauri = globalThis.isTauri;

function installElectronIdentityBridge(overrides = {}) {
  const calls = [];
  globalThis.window = {
    stage0: {
      identity: {
        isSharedIdentity: (...args) => {
          calls.push(["isSharedIdentity", args]);
          return Promise.resolve({ value: true });
        },
        getIdentity: (...args) => {
          calls.push(["getIdentity", args]);
          return Promise.resolve({
            display_name: "Fresh identity",
            locked: false,
            lost: false,
            pubkey: "a".repeat(64),
            reset_failed: false,
            storage: "system-keyring",
          });
        },
        ...overrides,
      },
    },
  };
  return calls;
}

test.afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalIsTauri === undefined) delete globalThis.isTauri;
  else globalThis.isTauri = originalIsTauri;
});

test("Electron identity metadata requires exactly the six frozen fields", () => {
  const identity = normalizeElectronIdentity({
    display_name: "Fresh identity",
    locked: false,
    lost: false,
    pubkey: "a".repeat(64),
    reset_failed: false,
    storage: "system-keyring",
  });

  assert.deepEqual(identity, {
    displayName: "Fresh identity",
    locked: false,
    lost: false,
    pubkey: "a".repeat(64),
    resetFailed: false,
    storage: "system-keyring",
  });

  assert.throws(
    () =>
      normalizeElectronIdentity({
        display_name: "Fresh identity",
        locked: false,
        lost: false,
        pubkey: "a".repeat(64),
        reset_failed: false,
        storage: "system-keyring",
        unexpected: true,
      }),
    /identity response is invalid/,
  );
  assert.throws(
    () =>
      normalizeElectronIdentity({
        display_name: "Fresh identity",
        locked: false,
        lost: false,
        pubkey: "a".repeat(64),
        reset_failed: false,
        storage: "unknown",
      }),
    /storage is invalid/,
  );
});

test("Electron shared-identity response rejects malformed values", () => {
  assert.equal(normalizeElectronSharedIdentity({ value: true }), true);
  assert.throws(
    () => normalizeElectronSharedIdentity({ value: true, extra: false }),
    /shared-identity response is invalid/,
  );
  assert.throws(
    () => normalizeElectronSharedIdentity({ value: "true" }),
    /field value is invalid/,
  );
});

test("Electron uses named identity methods and only exposes read capabilities", async () => {
  const calls = installElectronIdentityBridge();

  assert.equal(detectNativeShell(), "electron");
  assert.equal(supportsNativeCapability("identity-read"), true);
  assert.equal(supportsNativeCapability("identity-backup"), false);
  assert.equal(supportsNativeCapability("workspace-events"), false);

  assert.equal(await getSharedIdentity(), true);
  const identity = await getNativeIdentity();
  assert.equal(identity.pubkey, "a".repeat(64));
  assert.deepEqual(
    calls.map(([method, args]) => [method, args.length]),
    [
      ["isSharedIdentity", 0],
      ["getIdentity", 0],
    ],
  );
});

test("Electron lost identity names unsupported import before the flow mounts", () => {
  installElectronIdentityBridge();

  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: true,
      supportsCapability: supportsNativeCapability,
    }),
    {
      page: "unsupported",
      unsupportedCapability: "identity-import",
    },
  );

  globalThis.isTauri = true;
  globalThis.window = {
    __TAURI_INTERNALS__: { invoke: async () => undefined },
  };
  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: true,
      supportsCapability: supportsNativeCapability,
    }),
    {
      page: "key-import",
      unsupportedCapability: null,
    },
  );
});

test("Electron missing or rejected identity bridges fail closed without Tauri fallback", async () => {
  globalThis.window = { stage0: {} };
  await assert.rejects(getSharedIdentity, /identity bridge is unavailable/);

  installElectronIdentityBridge({
    isSharedIdentity: async () => {
      throw new Error("private backend path and keychain detail");
    },
  });
  await assert.rejects(
    getSharedIdentity,
    (error) =>
      error instanceof Error &&
      error.message === "Electron identity request failed." &&
      !error.message.includes("private backend"),
  );
});

test("Tauri keeps the existing command boundary and full native capability set", async () => {
  const calls = [];
  // Existing Tauri tests and the real runtime provide the internal invoke
  // object even when the optional global marker is absent.
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
