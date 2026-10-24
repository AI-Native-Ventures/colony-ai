import {
  deleteSaveSubscription,
  listSaveSubscriptions,
  mergeSaveSubscriptionKinds,
  type SaveSubscription,
  type ScopeType,
} from "@/shared/api/tauriArchive";
import {
  KIND_AGENT_OBSERVER_FRAME,
  KIND_AGENT_TURN_METRIC,
} from "@/shared/constants/kinds";
import { setExplicitAgentMetricArchiveChoice } from "./agentMetricArchivePreference";
import { setExplicitObserverArchiveChoice } from "./observerArchivePreference";

/**
 * The one local-archive switch in Preferences ("Keep a copy of messages on this
 * computer"). It drives the same saved subscriptions and per-identity choices
 * the former Storage page did, so the native sync task, the default-on seeding
 * and the opt-out memory all behave as before:
 *
 * - On: the two default subscriptions (agent observer frames and agent turn
 *   metrics) exist, and the choice to keep them is remembered.
 * - Off: every saved subscription is deleted, so nothing is left for the native
 *   sync task to listen for (each change wakes it to reload), and the opt-out
 *   is remembered so the default-on seeding does not bring them back.
 *
 * What is already saved stays on the computer; only new archiving stops.
 */
export type LocalArchiveSwitchDeps = {
  list: () => Promise<SaveSubscription[]>;
  remove: (scopeType: ScopeType, scopeValue: string) => Promise<unknown>;
  merge: (kind: number) => Promise<void>;
  rememberObserverChoice: (pubkey: string, enabled: boolean) => void;
  rememberMetricChoice: (pubkey: string, enabled: boolean) => void;
};

export const defaultLocalArchiveSwitchDeps: LocalArchiveSwitchDeps = {
  list: listSaveSubscriptions,
  remove: deleteSaveSubscription,
  merge: mergeSaveSubscriptionKinds,
  rememberObserverChoice: setExplicitObserverArchiveChoice,
  rememberMetricChoice: setExplicitAgentMetricArchiveChoice,
};

/** The switch reads on while anything is still being saved. */
export function isLocalArchiveOn(
  subscriptions: readonly Pick<SaveSubscription, "kinds">[],
): boolean {
  return subscriptions.length > 0;
}

/**
 * Applies the switch. Rejects when the archive could not be changed, leaving
 * the remembered choices untouched so a later attempt starts from the truth.
 */
export async function setLocalArchiveOn(
  pubkey: string,
  on: boolean,
  deps: LocalArchiveSwitchDeps = defaultLocalArchiveSwitchDeps,
): Promise<void> {
  if (on) {
    await deps.merge(KIND_AGENT_OBSERVER_FRAME);
    await deps.merge(KIND_AGENT_TURN_METRIC);
  } else {
    const subscriptions = await deps.list();
    for (const subscription of subscriptions) {
      await deps.remove(subscription.scopeType, subscription.scopeValue);
    }
  }
  deps.rememberObserverChoice(pubkey, on);
  deps.rememberMetricChoice(pubkey, on);
}
