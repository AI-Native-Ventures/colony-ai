import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { isManagedAgentRunning } from "./useMentionSendFlow.helpers";

/** Longest a send waits for the managed agents before it goes ahead. */
export const MANAGED_AGENTS_SEND_BUDGET_MS = 4_000;
/** Longest one read may take. A host that never answers must not hold the
 * send, and a query's own retry (a second try after a pause) counts here. */
export const MANAGED_AGENTS_READ_TIMEOUT_MS = 1_500;
/** Pauses between reads while waiting, one per retry. */
export const MANAGED_AGENTS_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

export type ManagedAgentsForSend = {
  agents: ManagedAgent[];
  /**
   * The list answers for this moment: it was read from the host, or it was
   * cached and none of the mentioned agents is shown as running. `false` means
   * the host did not answer within the budget and `agents` is whatever the
   * cache held (possibly nothing). The send goes ahead, and the mention
   * reconciler checks the relay for every mention it makes.
   */
  verified: boolean;
};

/**
 * The managed agents a send decides its wakes from.
 *
 * GATE-303 (26 Oct, 3.0.3): a mention sent 3.6 s after launch got no wake.
 * The send read the list with `data ?? (await refetch()).data ?? []`, and a
 * read that had not answered, or had failed, became an empty list: no agent
 * was "managed", so none was woken, and nothing said so. Two things change:
 *
 * - A list that is not loaded is read again, with a short back-off, for up to
 *   `budgetMs`. Nothing is taken for an empty list.
 * - A mentioned agent the cache shows as running is checked against the host
 *   (which looks at the process itself). A harness that died leaves the cache
 *   saying "running" until the next poll, and a wake skipped on that word is a
 *   lost mention.
 *
 * When the host still does not answer, the send is not blocked (the message is
 * the person's, and the reconciler follows it up); the result says so.
 */
export async function loadManagedAgentsForSend({
  cached,
  refetch,
  mentionedPubkeys,
  budgetMs = MANAGED_AGENTS_SEND_BUDGET_MS,
  readTimeoutMs = MANAGED_AGENTS_READ_TIMEOUT_MS,
  retryDelaysMs = MANAGED_AGENTS_RETRY_DELAYS_MS,
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  nowMs = Date.now,
  warn = (message: string, error?: unknown) => console.warn(message, error),
}: {
  cached: ManagedAgent[] | undefined;
  /** Reads the list from the host and rejects when it cannot. */
  refetch: () => Promise<ManagedAgent[]>;
  mentionedPubkeys: readonly string[];
  budgetMs?: number;
  readTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  warn?: (message: string, error?: unknown) => void;
}): Promise<ManagedAgentsForSend> {
  if (cached) {
    const mentioned = new Set(mentionedPubkeys.map(normalizePubkey));
    const mentionedAgentLooksRunning = cached.some(
      (agent) =>
        mentioned.has(normalizePubkey(agent.pubkey)) &&
        agent.backend?.type !== "provider" &&
        isManagedAgentRunning(agent),
    );
    if (!mentionedAgentLooksRunning) {
      return { agents: cached, verified: true };
    }
  }

  const startedAt = nowMs();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return {
        agents: await withTimeout(refetch(), readTimeoutMs),
        verified: true,
      };
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      const spent = nowMs() - startedAt;
      if (delay === undefined || spent + delay > budgetMs) {
        warn(
          "[managedAgentsForSend] the host did not list the agents in time; sending without a verified list",
          error,
        );
        return { agents: cached ?? [], verified: false };
      }
      await sleep(delay);
    }
  }
}

/** Rejects when `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the host did not answer within ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
