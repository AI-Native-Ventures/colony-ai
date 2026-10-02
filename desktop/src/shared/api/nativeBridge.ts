import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauriTransport";
import type { Identity, IdentityStorage } from "@/shared/api/types";

/** Runtime shell selected by the frontend boundary. */
export type NativeShell = "tauri" | "web";

/** Capabilities that may be mounted by a given native shell. */
export type NativeCapability =
  | "identity-mode"
  | "identity-read"
  | "identity-create"
  | "identity-export"
  | "identity-import"
  | "identity-recovery"
  | "identity-backup"
  | "google-oauth"
  | "legacy-migration"
  | "deep-links"
  | "nostr-bind"
  | "updater"
  | "workspace-events"
  | "window-drag";

/** Stable, user-safe error used when a native feature is unavailable. */
export class NativeCapabilityError extends Error {
  readonly capability: NativeCapability;

  constructor(capability: NativeCapability) {
    super(`This feature is not available in the ${detectNativeShell()} app.`);
    this.name = "NativeCapabilityError";
    this.capability = capability;
  }
}

/** Stable, user-safe error used when the native bridge is unavailable. */
export class NativeBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeBridgeError";
  }
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

function hasTauriInternals(): boolean {
  if (typeof window === "undefined") return false;
  const internals = (window as Window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  return typeof internals === "object" && internals !== null;
}

/** Detect the native Tauri API, including Electron's installed Tauri shim. */
export function detectNativeShell(): NativeShell {
  if (isTauri() || hasTauriInternals()) return "tauri";
  return "web";
}

/** Return whether the named native capability is safe to call in this shell. */
export function supportsNativeCapability(
  _capability: NativeCapability,
): boolean {
  return detectNativeShell() === "tauri";
}

/** Throw a stable error instead of invoking an unsupported native operation. */
export function requireNativeCapability(capability: NativeCapability): void {
  if (!supportsNativeCapability(capability)) {
    throw new NativeCapabilityError(capability);
  }
}

/** Read the shared-identity mode through the native Tauri command boundary. */
export async function getSharedIdentity(): Promise<boolean> {
  if (detectNativeShell() === "tauri") {
    return invokeTauri<boolean>("is_shared_identity");
  }
  throw new NativeBridgeError("A native identity bridge is unavailable.");
}

/** Read identity metadata while preserving Tauri's established optional fields. */
export async function getNativeIdentity(): Promise<Identity> {
  if (detectNativeShell() === "tauri") {
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
  throw new NativeBridgeError("A native identity bridge is unavailable.");
}
