import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * One start, stop or restart of an agent at a time.
 *
 * GATE-304 (26 Oct, published 3.0.4): Scout was started for a mention and
 * stopped 5.5 s later, and nothing started it again. Several parts of the app
 * stop or restart an agent on their own (the Welcome starter reconcile, the
 * auto-restart policy, the Welcome kickoff, the mention reconciler's retry),
 * and each decided from what it read earlier, while a start for a mention was
 * in flight. Run through here, they queue behind each other instead of
 * interleaving, and a later one reads the agent as it is once the earlier one
 * is done.
 *
 * A start the person's own send fired is never queued behind anything (the
 * wake is what they are waiting on); it is only tracked, with
 * [`trackAgentStart`], so that everything that stops or restarts the agent on
 * its own waits for it to land first.
 *
 * Callers must not nest: work run here that asks to run here for the same
 * agent would wait on itself. A hold never outlasts [`MAX_HOLD_MS`]: a start
 * that hangs must not freeze the agent for good, so the next in line goes
 * ahead (and the warning says which operation was holding).
 */

/** Longest a queued operation waits for the one before it. */
export const MAX_HOLD_MS = 45_000;

type Hold = { done: Promise<unknown>; label: string };

const holds = new Map<string, Hold>();
/** Starts a person's send fired and that have not settled yet. */
const startsInFlight = new Map<string, Set<Promise<unknown>>>();

/**
 * Record a start fired outside the queue so queued operations wait for it. The
 * promise may reject; only its settling matters here.
 */
export function trackAgentStart(pubkey: string, start: Promise<unknown>): void {
  const key = normalizePubkey(pubkey);
  const set = startsInFlight.get(key) ?? new Set<Promise<unknown>>();
  startsInFlight.set(key, set);
  const settled = start.then(
    () => undefined,
    () => undefined,
  );
  set.add(settled);
  void settled.then(() => {
    set.delete(settled);
    if (set.size === 0 && startsInFlight.get(key) === set) {
      startsInFlight.delete(key);
    }
  });
}

/**
 * Runs `work` once every earlier operation on `pubkey` has finished, or has
 * held the agent for [`MAX_HOLD_MS`]. The result is `work`'s own: a failure
 * rejects here and does not stop the operations queued behind it.
 */
export function runAgentLifecycle<T>(
  pubkey: string,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = normalizePubkey(pubkey);
  const previous = holds.get(key);

  const run = (async () => {
    const starts = startsInFlight.get(key);
    if (previous || (starts && starts.size > 0)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        Promise.all([previous?.done, ...(starts ? [...starts] : [])]).then(
          () => false,
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), MAX_HOLD_MS);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) {
        console.warn(
          `[agentLifecycle] "${previous?.label ?? "a start"}" held ${key} for ${MAX_HOLD_MS} ms; "${label}" goes ahead`,
        );
      }
    }
    return work();
  })();

  const hold: Hold = {
    label,
    done: run.then(
      () => undefined,
      () => undefined,
    ),
  };
  holds.set(key, hold);
  void hold.done.then(() => {
    if (holds.get(key) === hold) holds.delete(key);
  });
  return run;
}

/** Whether an operation on the agent is running or queued, or a start fired by
 * a send has not landed. */
export function isAgentLifecycleBusy(pubkey: string): boolean {
  const key = normalizePubkey(pubkey);
  return holds.has(key) || startsInFlight.has(key);
}

/** Test isolation: forget every hold. Production never calls this. */
export function resetAgentLifecycle(): void {
  holds.clear();
  startsInFlight.clear();
}
