import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauriTransport";
import type { Identity, IdentityStorage } from "@/shared/api/types";

const IDENTITY_METADATA_FIELDS = [
  "pubkey",
  "display_name",
  "storage",
  "lost",
  "locked",
  "reset_failed",
] as const;

const SHARED_IDENTITY_FIELDS = ["value"] as const;

const IDENTITY_STORAGES = new Set<IdentityStorage>([
  "system-keyring",
  "local-file",
  "environment",
  "ephemeral",
]);

/** Runtime shell selected by the frontend boundary. */
export type NativeShell = "electron" | "tauri" | "web";

/** Capabilities that may be mounted by a given native shell. */
export type NativeCapability =
  | "identity-mode"
  | "identity-read"
  | "identity-create"
  | "identity-export"
  | "identity-import"
  | "identity-recovery"
  | "identity-backup"
  | "legacy-migration"
  | "deep-links"
  | "nostr-bind"
  | "updater"
  | "workspace-events"
  | "window-drag";

type RawElectronIdentity = {
  pubkey: string;
  display_name: string;
  storage: IdentityStorage;
  lost: boolean;
  locked: boolean;
  reset_failed: boolean;
};

type Stage0IdentityApi = {
  isSharedIdentity: () => Promise<unknown>;
  getIdentity: () => Promise<unknown>;
};

type Stage0Api = {
  identity?: Stage0IdentityApi;
};

declare global {
  interface Window {
    stage0?: Stage0Api;
  }
}

const ELECTRON_CAPABILITIES = new Set<NativeCapability>([
  "identity-mode",
  "identity-read",
]);

/** Stable, user-safe error used when a native feature is unavailable. */
export class NativeCapabilityError extends Error {
  readonly capability: NativeCapability;

  constructor(capability: NativeCapability) {
    super(`This feature is not available in the ${detectNativeShell()} app.`);
    this.name = "NativeCapabilityError";
    this.capability = capability;
  }
}

/** Stable, user-safe error used when the Electron bridge is absent or malformed. */
export class NativeBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeBridgeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length &&
    actual.every((field, index) => field === expected[index])
  );
}

function requireString(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new NativeBridgeError(`Electron identity field ${field} is invalid.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new NativeBridgeError(`Electron identity field ${field} is invalid.`);
  }
  return value;
}

/** @internal Exported for the narrow bridge contract tests. */
export function normalizeElectronSharedIdentity(value: unknown): boolean {
  if (!isRecord(value) || !hasExactFields(value, SHARED_IDENTITY_FIELDS)) {
    throw new NativeBridgeError(
      "Electron shared-identity response is invalid.",
    );
  }
  return requireBoolean(value.value, "value");
}

/** @internal Exported for the narrow bridge contract tests. */
export function normalizeElectronIdentity(value: unknown): Identity {
  if (!isRecord(value) || !hasExactFields(value, IDENTITY_METADATA_FIELDS)) {
    throw new NativeBridgeError("Electron identity response is invalid.");
  }

  const storage = value.storage;
  if (
    typeof storage !== "string" ||
    !IDENTITY_STORAGES.has(storage as IdentityStorage)
  ) {
    throw new NativeBridgeError("Electron identity field storage is invalid.");
  }

  const raw: RawElectronIdentity = {
    pubkey: requireString(value.pubkey, "pubkey"),
    display_name: requireString(value.display_name, "display_name", true),
    storage: storage as IdentityStorage,
    lost: requireBoolean(value.lost, "lost"),
    locked: requireBoolean(value.locked, "locked"),
    reset_failed: requireBoolean(value.reset_failed, "reset_failed"),
  };

  return fromRawIdentity(raw);
}

function fromRawIdentity(raw: {
  pubkey: string;
  display_name: string;
  storage?: IdentityStorage;
  lost?: boolean;
  locked?: boolean;
  reset_failed?: boolean;
}): Identity {
  return {
    pubkey: raw.pubkey,
    displayName: raw.display_name,
    storage: raw.storage,
    lost: raw.lost === true,
    locked: raw.locked === true,
    resetFailed: raw.reset_failed === true,
  };
}

/** @internal Exported for Tauri callers and focused boundary tests. */
export function fromTauriIdentity(raw: {
  pubkey: string;
  display_name: string;
  storage?: IdentityStorage;
  lost?: boolean;
  locked?: boolean;
  reset_failed?: boolean;
}): Identity {
  return fromRawIdentity(raw);
}

function stage0(): Stage0Api | undefined {
  return typeof window === "undefined" ? undefined : window.stage0;
}

/** Detect the host without treating an Electron health-only bridge as Tauri. */
export function detectNativeShell(): NativeShell {
  if (stage0() !== undefined) return "electron";
  if (isTauri()) return "tauri";
  return "web";
}

/** Return whether the named native capability is safe to call in this shell. */
export function supportsNativeCapability(
  capability: NativeCapability,
): boolean {
  const shell = detectNativeShell();
  if (shell === "electron") return ELECTRON_CAPABILITIES.has(capability);
  if (shell === "tauri") return true;
  return false;
}

/** Throw a stable error instead of invoking an unsupported native operation. */
export function requireNativeCapability(capability: NativeCapability): void {
  if (!supportsNativeCapability(capability)) {
    throw new NativeCapabilityError(capability);
  }
}

function electronIdentityApi(): Stage0IdentityApi {
  const api = stage0()?.identity;
  if (!api) {
    throw new NativeBridgeError("Electron identity bridge is unavailable.");
  }
  return api;
}

async function callElectron<T>(
  call: () => Promise<unknown>,
  normalize: (value: unknown) => T,
) {
  try {
    return normalize(await call());
  } catch (error) {
    if (error instanceof NativeBridgeError) throw error;
    throw new NativeBridgeError("Electron identity request failed.");
  }
}

/** Read the shared-identity mode through the named Tauri/Electron seam. */
export async function getSharedIdentity(): Promise<boolean> {
  const shell = detectNativeShell();
  if (shell === "tauri") {
    return invokeTauri<boolean>("is_shared_identity");
  }
  if (shell === "electron") {
    const api = electronIdentityApi();
    return callElectron(api.isSharedIdentity, normalizeElectronSharedIdentity);
  }
  throw new NativeBridgeError("A native identity bridge is unavailable.");
}

/** Read identity metadata while preserving Tauri's established optional fields. */
export async function getNativeIdentity(): Promise<Identity> {
  const shell = detectNativeShell();
  if (shell === "tauri") {
    return fromTauriIdentity(
      await invokeTauri<{
        pubkey: string;
        display_name: string;
        storage?: IdentityStorage;
        lost?: boolean;
        locked?: boolean;
        reset_failed?: boolean;
      }>("get_identity"),
    );
  }
  if (shell === "electron") {
    const api = electronIdentityApi();
    return callElectron(api.getIdentity, normalizeElectronIdentity);
  }
  throw new NativeBridgeError("A native identity bridge is unavailable.");
}
