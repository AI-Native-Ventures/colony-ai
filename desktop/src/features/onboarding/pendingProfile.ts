const PENDING_PROFILE_KEY = "colony-pending-profile.v1";

/** The name and avatar picked before the business exists, kept until it does. */
export type PendingProfile = {
  displayName: string;
  /** An inline avatar: a colour with initials, or a small photo, as a data URL. */
  avatarUrl?: string;
};

type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function key(pubkey: string) {
  return `${PENDING_PROFILE_KEY}:${pubkey.toLowerCase()}`;
}

/**
 * Remember the profile a person picked right after an advanced sign-in. There
 * is no relay to publish to yet, so it waits here until the business is set up
 * (see `ensureOnboardingProfile`).
 */
export function savePendingProfile(
  pubkey: string,
  profile: PendingProfile,
  storage: PendingStorage = localStorage,
) {
  try {
    storage.setItem(key(pubkey), JSON.stringify(profile));
  } catch {
    // Without storage the profile step simply starts over in the app.
  }
}

export function readPendingProfile(
  pubkey: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): PendingProfile | null {
  try {
    const raw = storage.getItem(key(pubkey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingProfile>;
    const displayName =
      typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
    const avatarUrl =
      typeof parsed.avatarUrl === "string" && parsed.avatarUrl.trim()
        ? parsed.avatarUrl
        : undefined;
    return displayName || avatarUrl ? { displayName, avatarUrl } : null;
  } catch {
    return null;
  }
}

export function clearPendingProfile(
  pubkey: string,
  storage: Pick<Storage, "removeItem"> = localStorage,
) {
  try {
    storage.removeItem(key(pubkey));
  } catch {
    // Nothing to clear.
  }
}
