import type { MentionReconciler } from "./mentionReconciler";

/**
 * The mention reconciler of the community on screen, for the send paths that
 * cannot reach the React tree that owns it. Set while the reconciler is
 * mounted (`useMentionReconciler`), cleared when it goes away, and cleared by
 * `resetCommunityState` so nothing keeps the previous community's relay.
 */
let current: MentionReconciler | null = null;

export function setMentionReconciler(next: MentionReconciler | null) {
  current = next;
}

export function resetMentionReconciler() {
  current?.dispose();
  current = null;
}

/** The person just sent a message that mentions `pubkeys`. A no-op when no
 * reconciler is mounted (before the community is ready, in unit tests). */
export function noteMentionSentToAgents(pubkeys: readonly string[]) {
  current?.noteMentionSent(pubkeys);
}

/**
 * The person asked to try again: replace the agent's harness, hand back what
 * it queued and lost, and start from the oldest unanswered mention. Resolves
 * to `false`, doing nothing, when no reconciler is mounted so the caller can
 * fall back to a plain forced start.
 */
export async function retryAgentWithMentions(
  pubkey: string,
  floorUnix: number,
): Promise<boolean> {
  const reconciler = current;
  if (!reconciler) return false;
  await reconciler.retryAgent(pubkey, floorUnix);
  return true;
}
