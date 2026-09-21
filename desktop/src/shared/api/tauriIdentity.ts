import { invokeTauri } from "@/shared/api/tauri";
import type { Identity, IdentityStorage } from "@/shared/api/types";
import {
  getNativeIdentity,
  requireNativeCapability,
  fromTauriIdentity,
} from "@/shared/api/nativeBridge";

type RawIdentity = {
  pubkey: string;
  display_name: string;
  storage?: IdentityStorage;
  lost?: boolean;
  locked?: boolean;
  reset_failed?: boolean;
};

export async function getIdentity(): Promise<Identity> {
  return getNativeIdentity();
}

export async function getNsec(): Promise<string> {
  requireNativeCapability("identity-export");
  return invokeTauri<string>("get_nsec");
}

export async function importIdentity(
  nsec: string,
  password?: string,
): Promise<Identity> {
  requireNativeCapability("identity-import");
  return fromTauriIdentity(
    await invokeTauri<RawIdentity>("import_identity", { nsec, password }),
  );
}

export async function persistCurrentIdentity(): Promise<Identity> {
  requireNativeCapability("identity-create");
  return fromTauriIdentity(
    await invokeTauri<RawIdentity>("persist_current_identity"),
  );
}

/**
 * Wipe all local Buzz state (keychain, App Support, WebKit, nest, OAuth cache,
 * CLI symlinks) and relaunch into first-run onboarding.
 *
 * The app restarts after this call completes. Callers should keep the pending
 * state until the process exits and only handle errors (e.g. display a toast).
 */
export async function signOut(): Promise<void> {
  requireNativeCapability("identity-recovery");
  await invokeTauri("sign_out");
}

export type GeneratePassphraseOptions = {
  /** Word count; Rust clamps to its allowed range (currently 3–10). */
  words?: number;
  /** Separator joined between words. Defaults to a space in Rust. */
  separator?: string;
};

/** Generate a word passphrase (EFF short wordlist, OS entropy) in Rust. */
export async function generateBackupPassphrase(
  options?: GeneratePassphraseOptions,
): Promise<string> {
  requireNativeCapability("identity-backup");
  return invokeTauri<string>("generate_backup_passphrase", {
    words: options?.words,
    separator: options?.separator,
  });
}

/** Encrypt the current identity as an in-memory NIP-49 backup for native save. */
export async function createNcryptsecBackup(password: string): Promise<string> {
  requireNativeCapability("identity-backup");
  return invokeTauri<string>("create_ncryptsec_backup", { password });
}

/** Save a portable backup copy. Returns null when the native dialog is cancelled. */
export async function saveNcryptsecCopy(
  ncryptsec: string,
): Promise<string | null> {
  requireNativeCapability("identity-backup");
  return (
    (await invokeTauri<string | null>("save_ncryptsec_copy", { ncryptsec })) ??
    null
  );
}

export type BackupVerification = {
  pubkey: string;
  npub: string;
  matchesCurrentIdentity: boolean;
};

/** Decrypt locally and return only the backup's public identity and match state. */
export async function verifyNcryptsecBackup(
  ncryptsec: string,
  password: string,
): Promise<BackupVerification> {
  requireNativeCapability("identity-backup");
  return invokeTauri<BackupVerification>("verify_ncryptsec_backup", {
    ncryptsec,
    password,
  });
}
