export type DevicePrivacyPreferences = {
  showMessageText: boolean;
  shareTypingActivity: boolean;
};

export const DEFAULT_DEVICE_PRIVACY_PREFERENCES: DevicePrivacyPreferences = {
  showMessageText: false,
  shareTypingActivity: false,
};

const DEVICE_PRIVACY_STORAGE_PREFIX = "colony.device-privacy.v1";

export function devicePrivacyStorageKey(pubkey: string): string | null {
  const normalized = pubkey.trim().toLowerCase();
  return normalized ? `${DEVICE_PRIVACY_STORAGE_PREFIX}:${normalized}` : null;
}

export function readDevicePrivacyPreferences(
  pubkey: string | undefined,
  storage?: Pick<Storage, "getItem">,
): DevicePrivacyPreferences {
  const key = devicePrivacyStorageKey(pubkey ?? "");
  if (!key) return DEFAULT_DEVICE_PRIVACY_PREFERENCES;

  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return DEFAULT_DEVICE_PRIVACY_PREFERENCES;
    const raw = target.getItem(key);
    if (!raw) return DEFAULT_DEVICE_PRIVACY_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DevicePrivacyPreferences>;
    return {
      showMessageText: parsed.showMessageText === true,
      shareTypingActivity: parsed.shareTypingActivity === true,
    };
  } catch {
    return DEFAULT_DEVICE_PRIVACY_PREFERENCES;
  }
}

export function writeDevicePrivacyPreferences(
  pubkey: string | undefined,
  preferences: DevicePrivacyPreferences,
  storage?: Pick<Storage, "setItem">,
): boolean {
  const key = devicePrivacyStorageKey(pubkey ?? "");
  if (!key) return false;
  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return false;
    target.setItem(key, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
