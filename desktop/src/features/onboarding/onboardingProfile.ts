import { getAccountAuthClient } from "./accountAuthAdapter";
import {
  loadCommunities,
  normalizeRelayUrl,
} from "@/features/communities/communityStorage";
import {
  copyAvatarToActiveCommunity,
  getProfile,
  getProfileAtRelay,
  updateProfile,
} from "@/shared/api/tauriProfiles";
import type { Profile, UpdateProfileInput } from "@/shared/api/types";
import { clearPendingProfile, readPendingProfile } from "./pendingProfile";

const SIGNUP_NAME_KEY = "colony-signup-name.v1";

/** Preserve the submitted name across verification and restart, scoped by email. */
export function rememberSignupName(email: string, name: string) {
  localStorage.setItem(
    `${SIGNUP_NAME_KEY}:${email.trim().toLowerCase()}`,
    name.trim(),
  );
}

/** The name typed at sign-up for this email, or "" when none was kept. */
export function readRememberedSignupName(email: string): string {
  try {
    return (
      localStorage
        .getItem(`${SIGNUP_NAME_KEY}:${email.trim().toLowerCase()}`)
        ?.trim() ?? ""
    );
  } catch {
    return "";
  }
}

async function readWithDeadline<T>(
  request: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Account details could not be loaded. Check your connection and try again.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const MAX_CARRY_SOURCES = 8;

type CarryDependencies = {
  relays: (activeRelayUrl: string | undefined) => string[];
  read: (input: {
    relayUrl: string;
    expectedPubkey: string;
  }) => Promise<Profile>;
  copyAvatar: (input: {
    sourceRelayUrl: string;
    avatarUrl: string;
  }) => Promise<string>;
  write: (input: UpdateProfileInput) => Promise<Profile>;
};

/** The person's other workspaces, once each, never the one being set up. */
export function otherWorkspaceRelays(
  communities: readonly { relayUrl: string }[],
  activeRelayUrl: string | undefined,
): string[] {
  const active = activeRelayUrl
    ? normalizeRelayUrl(activeRelayUrl).replace(/\/$/, "").toLowerCase()
    : null;
  const seen = new Map<string, string>();
  for (const community of communities) {
    const url = normalizeRelayUrl(community.relayUrl);
    const key = url.replace(/\/$/, "").toLowerCase();
    if (key !== active && !seen.has(key)) seen.set(key, url);
  }
  return [...seen.values()].slice(0, MAX_CARRY_SOURCES);
}

const carryDefaults: CarryDependencies = {
  relays: (activeRelayUrl) =>
    otherWorkspaceRelays(loadCommunities(), activeRelayUrl),
  read: getProfileAtRelay,
  copyAvatar: copyAvatarToActiveCommunity,
  write: updateProfile,
};

/**
 * Start a new workspace from the profile the person already has in another one:
 * the same name and picture, unless they change it here. A picture stored by
 * the other workspace is copied into this workspace's media store, never linked
 * across the community boundary. Resolves null when no other workspace has a
 * named profile, or none could be read, so the caller falls back.
 */
export async function carryProfileFromOtherWorkspace(
  pubkey: string,
  activeRelayUrl: string | undefined,
  isCurrent = () => true,
  deps: CarryDependencies = carryDefaults,
): Promise<Profile | null> {
  for (const relayUrl of deps.relays(activeRelayUrl).slice(0, 0)) {
    if (!isCurrent()) throw new Error("Community setup cancelled.");
    let source: Profile;
    try {
      source = await deps.read({ relayUrl, expectedPubkey: pubkey });
    } catch {
      continue;
    }
    const displayName = source.displayName?.trim();
    if (!source.hasProfileEvent || !displayName) continue;
    let avatarUrl: string | undefined;
    if (source.avatarUrl?.trim()) {
      // A picture that cannot be copied is dropped; the name still carries.
      avatarUrl = await deps
        .copyAvatar({ sourceRelayUrl: relayUrl, avatarUrl: source.avatarUrl })
        .catch(() => undefined);
    }
    if (!isCurrent()) throw new Error("Community setup cancelled.");
    return deps.write({
      displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(source.about?.trim() ? { about: source.about } : {}),
      ...(source.jobTitle?.trim() ? { jobTitle: source.jobTitle } : {}),
    });
  }
  return null;
}

type OnboardingProfileDependencies = {
  read: typeof getProfile;
  account: () => Promise<{ pubkey?: string; email: string } | null | undefined>;
  write: typeof updateProfile;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  timeoutMs?: number;
  /** Test seam for reading other workspaces; production uses the real ones. */
  carryDependencies?: CarryDependencies;
};

/**
 * Publish the profile for a workspace the person just created or joined, through
 * the same kind:0 path as Settings. A profile already published here is kept.
 * Otherwise a name and picture picked at sign-up win, then the profile the
 * person already has in another workspace, then the account name.
 */
export async function ensureOnboardingProfile(
  isCurrent = () => true,
  dependencies: OnboardingProfileDependencies = {
    read: getProfile,
    account: () => getAccountAuthClient().getAccount(),
    write: updateProfile,
    storage: localStorage,
    timeoutMs: 10_000,
  },
  relayUrl?: string,
) {
  const profile = await readWithDeadline(
    dependencies.read(),
    dependencies.timeoutMs ?? 10_000,
  );
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  if (profile.hasProfileEvent) return profile;
  // A name and avatar picked right after an advanced sign-in, before there was
  // a relay to publish them to.
  const pending = readPendingProfile(profile.pubkey, dependencies.storage);
  if (pending?.displayName) {
    if (!isCurrent()) throw new Error("Community setup cancelled.");
    const saved = await dependencies.write({
      displayName: pending.displayName,
      ...(pending.avatarUrl ? { avatarUrl: pending.avatarUrl } : {}),
    });
    // Cleared only after the relay has it, so a failed publish retries.
    clearPendingProfile(profile.pubkey, dependencies.storage);
    return saved;
  }
  const carried = await carryProfileFromOtherWorkspace(
    profile.pubkey,
    relayUrl,
    isCurrent,
    dependencies.carryDependencies,
  ).catch((error: unknown) => {
    if (!isCurrent()) throw error;
    return null;
  });
  if (carried) return carried;
  const account = await readWithDeadline(
    dependencies.account(),
    dependencies.timeoutMs ?? 10_000,
  );
  const email = account?.pubkey === profile.pubkey ? account.email : "";
  const key = `${SIGNUP_NAME_KEY}:${email.trim().toLowerCase()}`;
  const displayName =
    dependencies.storage.getItem(key)?.trim() ||
    email.split("@")[0] ||
    (profile.displayName?.trim() !== "You"
      ? profile.displayName?.trim()
      : "") ||
    "";
  if (!displayName) return profile;
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  const saved = await dependencies.write({ displayName });
  return saved;
}
