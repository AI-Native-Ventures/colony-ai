import type {
  KeyRescueLockedAgent,
  KeyRescueOutcome,
  KeyRescueStatus,
} from "@/shared/api/keyRescue";

export const KEY_RESCUE_OFFER_TEXT =
  "Your agents' keys are still in the Mac Keychain from an earlier version. Colony can move them once. macOS will ask for your Mac password; choose Always Allow.";
export const KEY_RESCUE_BUTTON_LABEL = "Move my agents' keys";
export const KEY_RESCUE_PENDING_LABEL = "Waiting for macOS";
export const KEY_RESCUE_DONE_TEXT =
  "Your agents' keys are moved. Colony left the old Keychain item as it was.";
export const KEY_RESCUE_READD_TEXT =
  "Delete each of these agents and add it again to give it a new key. Colony left the old Keychain item as it was.";

export type KeyRescueCardState =
  | { kind: "hidden" }
  | { kind: "offer"; text: string }
  | { kind: "done"; text: string }
  | {
      kind: "failed";
      headline: string;
      agentNames: string[];
      guidance: string;
    };

const FAILED_HEADLINE: Record<KeyRescueOutcome, string> = {
  rescued: "Some agents could not be moved.",
  partial: "Some agents could not be moved.",
  nothingFound: "The Keychain had no keys for these agents.",
  denied: "macOS did not let Colony read the old keys.",
  notFound: "No old keys were found in the Mac Keychain.",
  unreadable: "Colony could not read the old keys.",
};

/**
 * The agents this card is about. On the agents page that is every locked
 * agent; in a conversation it is only the locked agents taking part in it.
 */
function inScope(
  locked: KeyRescueLockedAgent[],
  scopePubkeys: readonly string[] | null,
): KeyRescueLockedAgent[] {
  if (!scopePubkeys) return locked;
  const wanted = new Set(scopePubkeys.map((pubkey) => pubkey.toLowerCase()));
  return locked.filter((agent) => wanted.has(agent.pubkey.toLowerCase()));
}

/**
 * Decide what the rescue card shows.
 *
 * - Before any attempt, the offer, and only when it applies to this place.
 * - After an attempt, the agents that are still locked and the way out
 *   (delete and add again). No button: the rescue is offered once.
 * - Right after a successful click, a short confirmation.
 */
export function keyRescueCardState(
  status: KeyRescueStatus | null | undefined,
  options: {
    scopePubkeys?: readonly string[] | null;
    justMoved?: boolean;
  } = {},
): KeyRescueCardState {
  if (!status) return { kind: "hidden" };
  const scoped = inScope(status.lockedAgents, options.scopePubkeys ?? null);

  if (status.offer) {
    // A conversation shows the card only when one of its agents is locked;
    // the agents page shows it whenever the rescue is on offer.
    const applies = options.scopePubkeys ? scoped.length > 0 : true;
    return applies
      ? { kind: "offer", text: KEY_RESCUE_OFFER_TEXT }
      : { kind: "hidden" };
  }

  if (!status.attempt) return { kind: "hidden" };

  if (scoped.length > 0) {
    return {
      kind: "failed",
      headline: FAILED_HEADLINE[status.attempt.outcome],
      agentNames: scoped.map((agent) => agent.name),
      guidance: KEY_RESCUE_READD_TEXT,
    };
  }

  return options.justMoved && status.attempt.agentsMoved.length > 0
    ? { kind: "done", text: KEY_RESCUE_DONE_TEXT }
    : { kind: "hidden" };
}
