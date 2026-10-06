import {
  isRelayMembershipDeniedError,
  relayMembershipDenialDetail,
} from "@/shared/lib/relayMembershipDenied";

/**
 * Remembers that the open workspace was refused for lack of relay membership,
 * so the app can swap the workspace for the community escape screen.
 *
 * Community-scoped singleton: `resetMembershipDenialGate()` is wired into
 * `resetCommunityState()`. Every report carries the generation and community
 * the reporter was mounted for, so a late denial from a community the person
 * already left can never be applied to the one they switched to.
 */
export type MembershipDenial = {
  communityId: string;
  detail: string;
};

let generation = 0;
let denial: MembershipDenial | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The generation a reporter must capture when it mounts. */
export function currentMembershipDenialGeneration(): number {
  return generation;
}

/**
 * Record a denial. Returns true only when it changed what the app shows:
 * stale generations, other errors, and repeats within one generation are
 * ignored, so many queries failing together raise the screen exactly once.
 */
export function reportMembershipDenial(
  reporterGeneration: number,
  communityId: string,
  error: unknown,
): boolean {
  if (reporterGeneration !== generation) return false;
  if (!isRelayMembershipDeniedError(error)) return false;
  if (denial) return false;
  denial = { communityId, detail: relayMembershipDenialDetail(error) };
  notify();
  return true;
}

export function getMembershipDenial(): MembershipDenial | null {
  return denial;
}

export function subscribeMembershipDenial(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Start a new generation: drops the denial and fences every older reporter. */
export function resetMembershipDenialGate(): void {
  generation += 1;
  if (denial === null) return;
  denial = null;
  notify();
}
