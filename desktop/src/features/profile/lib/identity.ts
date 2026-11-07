import type { Profile, UserProfileSummary } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export type UserProfileLookup = Record<string, UserProfileSummary>;

/**
 * The presentable identity for a person or an AI employee. Keep this separate
 * from a public key: a key is an authority and routing value, never a label
 * a teammate should have to read.
 */
export type ResolvedIdentityLabel = {
  /** Complete text for plain-text surfaces, composer insertion, and ARIA. */
  text: string;
  /** The person's or agent's own name, without an agent-owner suffix. */
  primary: string;
  /** Short owner label shown in muted text for an agent someone else owns. */
  ownerSuffix: string | null;
  /** Full owner label for the suffix tooltip. */
  ownerTooltip: string | null;
  /** Only present when one owner has multiple agents with the same name. */
  duplicateOrdinal: number | null;
  isAgent: boolean;
};

export type IdentityLabelInput = {
  pubkey: string;
  currentPubkey?: string | null;
  fallbackName?: string | null;
  profiles?: UserProfileLookup;
  /** Profiles fetched for agent owners when they are outside the current view. */
  ownerProfiles?: UserProfileLookup;
  /** Directory/roster provenance can identify an agent before kind:0 arrives. */
  isAgent?: boolean;
  /** Directory/roster provenance wins when a cold kind:0 is still absent. */
  ownerPubkey?: string | null;
  preferResolvedSelfLabel?: boolean;
  /** Prefer this agent's bare name when same-owner duplicates need labels. */
  preferUnqualifiedDuplicate?: boolean;
};

/**
 * Deep-equal two profile lookups by value. Used to stabilise the merged
 * `messageProfiles` reference at the ChannelScreen boundary: the underlying
 * `users-batch` query re-keys on the full sorted pubkey set, so typing churn
 * (a transient typing-only pubkey entering/leaving the set) produces a fresh
 * lookup object identity even when no profile value actually changed. That new
 * reference fails MessageRow's `prev.profiles === next.profiles` memo check and
 * re-renders the entire timeline on every keystroke-adjacent typing event.
 * Returning the previous reference when this reports equal keeps the memo
 * intact. Consumers read profiles by pubkey value only, never treating identity
 * as a change signal, so returning the stale-but-value-identical reference is
 * safe.
 */
export function profileLookupsEqual(
  a: UserProfileLookup,
  b: UserProfileLookup,
): boolean {
  if (a === b) {
    return true;
  }

  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  for (const key of aKeys) {
    const prev = a[key];
    const next = b[key];
    if (
      next === undefined ||
      prev.displayName !== next.displayName ||
      prev.name !== next.name ||
      prev.avatarUrl !== next.avatarUrl ||
      prev.nip05Handle !== next.nip05Handle ||
      prev.jobTitle !== next.jobTitle ||
      prev.ownerPubkey !== next.ownerPubkey ||
      prev.isAgent !== next.isAgent
    ) {
      return false;
    }
  }

  return true;
}

function getResolvedProfile(
  pubkey: string,
  profiles: UserProfileLookup | undefined,
) {
  if (!profiles) {
    return null;
  }

  return profiles[normalizePubkey(pubkey)] ?? null;
}

const RAW_IDENTITY_LABEL =
  /^(?:npub1[0-9a-z.\u2026-]*|[0-9a-f]{40,}|[0-9a-f]{6,}\u2026[0-9a-f]{2,})$/iu;

/** A profile record may itself contain an old key-derived default name. */
export function isRawIdentityLabel(value: string): boolean {
  return RAW_IDENTITY_LABEL.test(value.trim());
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !isRawIdentityLabel(trimmed)) return trimmed;
  }
  return null;
}

function ownerDisplayName(
  ownerPubkey: string,
  profiles: UserProfileLookup | undefined,
  ownerProfiles: UserProfileLookup | undefined,
) {
  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey);
  const owner =
    ownerProfiles?.[normalizedOwnerPubkey] ?? profiles?.[normalizedOwnerPubkey];
  return firstNonEmpty(owner?.displayName, owner?.name, owner?.nip05Handle);
}

function ownerFirstName(label: string) {
  return label.split(/\s+/u)[0] || "teammate";
}

function identityBase(
  input: IdentityLabelInput,
): Omit<ResolvedIdentityLabel, "duplicateOrdinal" | "text"> {
  const profile = getResolvedProfile(input.pubkey, input.profiles);
  const ownerPubkey = input.ownerPubkey ?? profile?.ownerPubkey ?? null;
  const isAgent =
    input.isAgent ?? (profile?.isAgent === true || Boolean(ownerPubkey));
  const isCurrentUser =
    typeof input.currentPubkey === "string" &&
    normalizePubkey(input.currentPubkey) === normalizePubkey(input.pubkey);

  if (isCurrentUser && !input.preferResolvedSelfLabel) {
    return {
      primary: "You",
      ownerSuffix: null,
      ownerTooltip: null,
      isAgent,
    };
  }

  const primary =
    firstNonEmpty(
      profile?.displayName,
      profile?.name,
      profile?.nip05Handle,
      input.fallbackName,
    ) ?? "AI employee";

  const isOwnedByViewer =
    Boolean(input.currentPubkey) &&
    Boolean(ownerPubkey) &&
    normalizePubkey(input.currentPubkey ?? "") ===
      normalizePubkey(ownerPubkey ?? "");
  const ownerTooltip = ownerPubkey
    ? ownerDisplayName(ownerPubkey, input.profiles, input.ownerProfiles)
    : null;

  return {
    primary,
    ownerSuffix:
      isAgent && ownerPubkey && !isOwnedByViewer
        ? ownerTooltip
          ? ownerFirstName(ownerTooltip)
          : "teammate"
        : null,
    ownerTooltip,
    isAgent,
  };
}

function labelText(label: Omit<ResolvedIdentityLabel, "text">): string {
  const qualified = label.ownerSuffix
    ? `${label.primary} (${label.ownerSuffix})`
    : label.primary;
  return label.duplicateOrdinal
    ? `${qualified} ${label.duplicateOrdinal}`
    : qualified;
}

/**
 * Resolve a single visible identity without ever exposing its pubkey. Agent
 * owner data is deliberately an input, so every surface follows exactly the
 * same ownership rule instead of copying its own fallback ladder.
 */
export function resolveIdentityLabel(
  input: IdentityLabelInput,
): ResolvedIdentityLabel {
  const resolved = resolveIdentityLabels([input]).get(
    normalizePubkey(input.pubkey),
  );
  if (resolved) return resolved;

  // `resolveIdentityLabels` always returns one entry per input. Retain a
  // neutral safe result if an unexpected normalization defect ever breaks that
  // invariant, rather than letting a key become a display fallback.
  const base = identityBase(input);
  const label = { ...base, duplicateOrdinal: null };
  return { ...label, text: labelText(label) };
}

/**
 * Resolve a set of labels together. The shared set is what lets same-owner,
 * same-name agents receive a stable short ordinal without leaking a key.
 */
export function resolveIdentityLabels(
  inputs: readonly IdentityLabelInput[],
): Map<string, ResolvedIdentityLabel> {
  const entries = inputs.map((input) => ({
    input,
    pubkey: normalizePubkey(input.pubkey),
    base: identityBase(input),
  }));
  const sameOwnerNames = new Map<string, typeof entries>();

  for (const entry of entries) {
    if (!entry.base.isAgent) continue;
    const profile = getResolvedProfile(
      entry.input.pubkey,
      entry.input.profiles,
    );
    const ownerPubkey = entry.input.ownerPubkey ?? profile?.ownerPubkey ?? null;
    if (!ownerPubkey) continue;
    const ownerKey = normalizePubkey(ownerPubkey);
    const groupKey = `${entry.base.primary.toLocaleLowerCase()}:${ownerKey}`;
    const group = sameOwnerNames.get(groupKey) ?? [];
    group.push(entry);
    sameOwnerNames.set(groupKey, group);
  }

  const result = new Map<string, ResolvedIdentityLabel>();
  for (const entry of entries) {
    const profile = getResolvedProfile(
      entry.input.pubkey,
      entry.input.profiles,
    );
    const ownerPubkey = entry.input.ownerPubkey ?? profile?.ownerPubkey ?? null;
    const ownerKey = ownerPubkey ? normalizePubkey(ownerPubkey) : null;
    const groupKey = `${entry.base.primary.toLocaleLowerCase()}:${ownerKey}`;
    const group = ownerKey ? (sameOwnerNames.get(groupKey) ?? []) : [];
    const ordered = [...group].sort(
      (left, right) =>
        Number(right.input.preferUnqualifiedDuplicate === true) -
          Number(left.input.preferUnqualifiedDuplicate === true) ||
        left.pubkey.localeCompare(right.pubkey),
    );
    const preferredEntry = ordered[0]?.input.preferUnqualifiedDuplicate
      ? ordered[0]
      : null;
    const duplicateOrdinal =
      ordered.length > 1 && preferredEntry?.pubkey !== entry.pubkey
        ? ordered.findIndex((candidate) => candidate.pubkey === entry.pubkey) +
          1
        : null;
    const label: Omit<ResolvedIdentityLabel, "text"> = {
      ...entry.base,
      duplicateOrdinal,
    };
    result.set(entry.pubkey, { ...label, text: labelText(label) });
  }
  return result;
}

export function mergeCurrentProfileIntoLookup(
  profiles: UserProfileLookup | undefined,
  currentProfile:
    | (Pick<Profile, "pubkey" | "displayName" | "avatarUrl" | "nip05Handle"> &
        Partial<Pick<Profile, "jobTitle">>)
    | null
    | undefined,
) {
  if (!currentProfile) {
    return profiles;
  }

  return {
    ...(profiles ?? {}),
    [normalizePubkey(currentProfile.pubkey)]: {
      displayName: currentProfile.displayName,
      // `Profile` does not carry the kind-0 `name`; keep whatever the batch
      // lookup already resolved so mention aliases survive the merge.
      name: profiles?.[normalizePubkey(currentProfile.pubkey)]?.name ?? null,
      avatarUrl: currentProfile.avatarUrl,
      nip05Handle: currentProfile.nip05Handle,
      ...(currentProfile.jobTitle ||
      profiles?.[normalizePubkey(currentProfile.pubkey)]?.jobTitle
        ? {
            jobTitle:
              currentProfile.jobTitle ??
              profiles?.[normalizePubkey(currentProfile.pubkey)]?.jobTitle,
          }
        : {}),
      isAgent: profiles?.[normalizePubkey(currentProfile.pubkey)]?.isAgent,
      ownerPubkey:
        profiles?.[normalizePubkey(currentProfile.pubkey)]?.ownerPubkey ?? null,
    },
  };
}

export function resolveUserLabel(input: {
  pubkey: string;
  currentPubkey?: string;
  fallbackName?: string | null;
  profiles?: UserProfileLookup;
  ownerProfiles?: UserProfileLookup;
  isAgent?: boolean;
  ownerPubkey?: string | null;
  preferResolvedSelfLabel?: boolean;
}) {
  return resolveIdentityLabel(input).text;
}

/**
 * Returns true when the current user owns the agent that authored a message.
 * Mirrors the relay's `is_agent_owner` gate: ownership is determined by the
 * NIP-OA `ownerPubkey` field on the author's profile, NOT by the local
 * managed-agents list (which can diverge from server-side ownership).
 */
export function ownsAuthorAgent(
  profile: { ownerPubkey: string | null } | undefined,
  currentPubkey: string | undefined,
): boolean {
  return (
    !!currentPubkey &&
    !!profile?.ownerPubkey &&
    normalizePubkey(profile.ownerPubkey) === normalizePubkey(currentPubkey)
  );
}

export function resolveUserSecondaryLabel(input: {
  pubkey: string;
  profiles?: UserProfileLookup;
}) {
  const profile = getResolvedProfile(input.pubkey, input.profiles);
  const displayName = profile?.displayName?.trim();
  const nip05Handle = profile?.nip05Handle?.trim();

  if (displayName && nip05Handle) {
    return nip05Handle;
  }

  return null;
}

/**
 * Label for an agent's owner: "you" when the current user owns it, otherwise
 * the owner's display name, NIP-05 handle, or the neutral teammate fallback.
 */
export function formatOwnerLabel(
  ownerPubkey: string | null | undefined,
  currentPubkey: string | null | undefined,
  ownerProfiles?: UserProfileLookup,
) {
  if (!ownerPubkey) {
    return null;
  }

  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey);
  if (
    currentPubkey &&
    normalizedOwnerPubkey === normalizePubkey(currentPubkey)
  ) {
    return "you";
  }

  const owner = ownerProfiles?.[normalizedOwnerPubkey];
  return (
    firstNonEmpty(owner?.displayName, owner?.name, owner?.nip05Handle) ??
    "teammate"
  );
}
