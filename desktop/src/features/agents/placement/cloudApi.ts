import { invokeTauri } from "@/shared/api/tauri";

/** What the relay says this account may do with cloud agents. */
export type CloudCapabilities = {
  enabled: boolean;
  allowed: boolean;
  maxPerAccount: number;
  models: string[];
  defaultModel: string | null;
};

export const NO_CLOUD_CAPABILITIES: CloudCapabilities = Object.freeze({
  enabled: false,
  allowed: false,
  maxPerAccount: 0,
  models: [],
  defaultModel: null,
}) as CloudCapabilities;

export type CloudUploadOutcome =
  | { result: "uploaded"; version: number }
  | { result: "unchanged" }
  | { result: "notAllowed" };

export function getCloudCapabilities(): Promise<CloudCapabilities> {
  return invokeTauri<CloudCapabilities>("get_cloud_capabilities");
}

/**
 * Uploads one agent's key and config so the relay can run it in the cloud.
 * `relayReady` and `relayConfigVersion` are what the placement head says the
 * relay holds: an unchanged agent the relay already has is skipped natively.
 */
export function uploadCloudBundle(input: {
  pubkey: string;
  relayReady: boolean;
  relayConfigVersion: number;
}): Promise<CloudUploadOutcome> {
  return invokeTauri<CloudUploadOutcome>("upload_cloud_bundle", {
    pubkey: input.pubkey,
    relayReady: input.relayReady,
    relayConfigVersion: input.relayConfigVersion,
  });
}
