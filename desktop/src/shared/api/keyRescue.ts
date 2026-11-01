import { invokeTauri } from "@/shared/api/tauriTransport";

/** How the one-time Keychain key rescue ended. */
export type KeyRescueOutcome =
  | "rescued"
  | "partial"
  | "nothingFound"
  | "denied"
  | "notFound"
  | "unreadable";

export type KeyRescueAttempt = {
  attemptedAtUnix: number;
  outcome: KeyRescueOutcome;
  /** Public keys of the agents whose key was moved. */
  agentsMoved: string[];
  deviceSecretsMoved: number;
  identity: "notInKeychain" | "keptCurrent" | "restored" | "differentAccount";
};

export type KeyRescueLockedAgent = { pubkey: string; name: string };

export type KeyRescueStatus = {
  /** True only while the one-time card should be shown with its button. */
  offer: boolean;
  /** Agents with no usable key on this device. */
  lockedAgents: KeyRescueLockedAgent[];
  /** Set once the rescue has been tried, whatever happened. */
  attempt: KeyRescueAttempt | null;
};

/** Read what to show. Never touches the macOS Keychain. */
export function getKeyRescueStatus(): Promise<KeyRescueStatus> {
  return invokeTauri<KeyRescueStatus>("get_key_rescue_status");
}

/**
 * The owner's click: read the old Keychain item once and move agent keys out.
 * macOS shows its own password prompt here, and only here.
 */
export function rescueLegacyKeys(): Promise<KeyRescueStatus> {
  return invokeTauri<KeyRescueStatus>("rescue_legacy_keys");
}
