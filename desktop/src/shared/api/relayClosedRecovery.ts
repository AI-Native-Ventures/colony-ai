import { classifyRelayClosed } from "@/shared/api/relayClosedPolicy";
import {
  activateRateLimit,
  parseRateLimitHint,
  rateLimitRemainingMs,
} from "@/shared/api/relayRateLimitGate";
import {
  relaySubscriptionFilters,
  sortEvents,
  type RelaySubscription,
  type RelaySubscriptionFilter,
  type SubscriptionEventBufferItem,
} from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_JITTER_MS = 250;

type LiveSubscription = Extract<RelaySubscription, { mode: "live" }>;
type ReadSubscription = Exclude<RelaySubscription, LiveSubscription>;

export function clearClosedRetry(subscription: LiveSubscription) {
  if (subscription.closedRetryTimeout === undefined) return;
  window.clearTimeout(subscription.closedRetryTimeout);
  subscription.closedRetryTimeout = undefined;
}

export function handleRelayClosed({
  subscriptions,
  subId,
  message,
  sendReq,
  closeSubscription,
  random = () => 0,
}: {
  subscriptions: Map<string, RelaySubscription>;
  subId: string;
  message: string;
  sendReq: (
    subId: string,
    filters: readonly RelaySubscriptionFilter[],
  ) => Promise<void>;
  closeSubscription?: (subId: string) => Promise<void>;
  random?: () => number;
}) {
  const subscription = subscriptions.get(subId);
  if (!subscription) return;
  if (subscription.mode !== "live") {
    // Classify before acting so a `rate-limited:` CLOSED arms the gate for
    // concurrent ops regardless of whether this specific sub can be retried.
    const closedClass = classifyRelayClosed(message);
    if (closedClass === "rate-limited") {
      const hintSeconds = parseRateLimitHint(message);
      activateRateLimit(hintSeconds);

      if (
        scheduleRateLimitedReadRetry({
          subscriptions,
          subId,
          subscription,
          hintSeconds,
          message,
          sendReq,
          closeSubscription,
          random,
        })
      ) {
        return;
      }
    }

    window.clearTimeout(subscription.timeout);
    subscriptions.delete(subId);
    subscription.reject(new Error(message || closedReadMessage(subscription)));
    return;
  }
  recoverLiveSubscriptionFromClosed({
    subscriptions,
    subId,
    subscription,
    message,
    sendReq,
    random,
  });
}

/**
 * Re-open a one-shot read after the relay's hinted rate-limit window.
 *
 * Both history and first-event subscriptions back a caller awaiting a read.
 * Keeping the retry here means they share one bounded lifecycle rather than
 * making first-event callers fail while history callers recover.
 */
function scheduleRateLimitedReadRetry({
  subscriptions,
  subId,
  subscription,
  hintSeconds,
  message,
  sendReq,
  closeSubscription,
  random,
}: {
  subscriptions: Map<string, RelaySubscription>;
  subId: string;
  subscription: ReadSubscription;
  hintSeconds: number | null;
  message: string;
  sendReq: (
    subId: string,
    filters: readonly RelaySubscriptionFilter[],
  ) => Promise<void>;
  closeSubscription?: (subId: string) => Promise<void>;
  random: () => number;
}): boolean {
  const attempt = subscription.closedRetryAttempt ?? 0;
  if (attempt >= RETRY_MAX_ATTEMPTS) return false;

  subscription.closedRetryAttempt = attempt + 1;
  // The operation timeout only covers a sent REQ. Clear it while this read is
  // waiting behind admission so it cannot reject before the retry is issued.
  window.clearTimeout(subscription.timeout);
  const hintMs = (hintSeconds ?? 10) * 1_000;
  const delayMs =
    Math.max(rateLimitRemainingMs() || hintMs, hintMs) + jitterMs(random);
  const newSubId = `${subscription.mode}-${crypto.randomUUID()}`;
  subscriptions.delete(subId);
  subscriptions.set(newSubId, subscription);

  subscription.timeout = window.setTimeout(() => {
    if (subscriptions.get(newSubId) !== subscription) return;
    void sendReq(newSubId, relaySubscriptionFilters(subscription)).catch(
      (error) => {
        if (subscriptions.get(newSubId) !== subscription) return;
        window.clearTimeout(subscription.timeout);
        subscriptions.delete(newSubId);
        subscription.reject(
          error instanceof Error
            ? error
            : new Error(message || closedReadMessage(subscription)),
        );
      },
    );
    // A retry that reaches the relay but never completes gets one fresh
    // operation timeout. The subscription is removed before it rejects so a
    // late EOSE or EVENT cannot settle the caller twice.
    subscription.timeout = window.setTimeout(() => {
      if (subscriptions.get(newSubId) !== subscription) return;
      subscriptions.delete(newSubId);
      // There is no retry owner after the read timeout. Avoid an unhandled
      // rejection from best-effort CLOSE while preserving the caller's error.
      closeSubscription?.(newSubId)?.catch(() => {});
      subscription.reject(new Error(closedReadMessage(subscription)));
    }, subscription.timeoutMs);
  }, delayMs);
  return true;
}

function closedReadMessage(subscription: ReadSubscription): string {
  return subscription.mode === "first"
    ? "Relay closed the first-event subscription."
    : "Relay closed the history subscription.";
}

function jitterMs(random: () => number): number {
  const sample = Math.max(0, Math.min(0.999_999, random()));
  return Math.floor(sample * RETRY_JITTER_MS);
}

function recoverLiveSubscriptionFromClosed({
  subscriptions,
  subId,
  subscription,
  message,
  sendReq,
  random,
}: {
  subscriptions: Map<string, RelaySubscription>;
  subId: string;
  subscription: LiveSubscription;
  message: string;
  sendReq: (
    subId: string,
    filters: readonly RelaySubscriptionFilter[],
  ) => Promise<void>;
  random: () => number;
}) {
  subscription.resolveReady?.("closed");
  subscription.resolveReady = undefined;

  const closedClass = classifyRelayClosed(message);

  if (closedClass === "terminal") {
    // Auth/access/filter failure — permanently remove the subscription so it
    // doesn't silently loop.
    subscriptions.delete(subId);
    subscription.onRetryExhausted?.();
    return;
  }

  if (subscription.closedRetryTimeout !== undefined) return;

  const attempt = subscription.closedRetryAttempt ?? 0;
  if (attempt >= RETRY_MAX_ATTEMPTS) {
    clearClosedRetry(subscription);
    subscriptions.delete(subId);
    subscription.onRetryExhausted?.();
    return;
  }
  const backoffMs = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );

  let delayMs =
    Math.min(RETRY_MAX_DELAY_MS, backoffMs * (0.8 + random() * 0.4)) +
    jitterMs(random);

  if (closedClass === "rate-limited") {
    // Activate the gate so concurrent operations back off too.
    const hintSeconds = parseRateLimitHint(message);
    activateRateLimit(hintSeconds);
    // Use the gate's actual remaining time so a shorter hint arriving under a
    // longer active gate does not schedule a premature retry that just gets
    // another CLOSED. The fallback covers the gate-inactive edge case
    // (hint * 1000, or 10s default when no hint).
    const fallbackMs = (hintSeconds ?? 10) * 1_000;
    delayMs =
      Math.max(delayMs, rateLimitRemainingMs() || fallbackMs) +
      jitterMs(random);
  }

  subscription.closedRetryAttempt = attempt + 1;
  subscription.closedRetryTimeout = window.setTimeout(() => {
    subscription.closedRetryTimeout = undefined;
    if (subscriptions.get(subId) !== subscription) return;
    void sendReq(subId, relaySubscriptionFilters(subscription)).catch(
      (error) => {
        if (subscriptions.get(subId) !== subscription) return;
        console.error("Failed to restore closed relay subscription", error);
        recoverLiveSubscriptionFromClosed({
          subscriptions,
          subId,
          subscription,
          message,
          sendReq,
          random,
        });
      },
    );
  }, delayMs);
}

export function prepareSubscriptionEvent(
  subscription: RelaySubscription,
  event: RelayEvent,
) {
  if (subscription.mode === "history") {
    subscription.events.push(event);
    return false;
  }
  if (subscription.mode === "first") {
    return false;
  }
  subscription.closedRetryAttempt = 0;
  clearClosedRetry(subscription);
  subscription.lastSeenCreatedAt = Math.max(
    subscription.lastSeenCreatedAt ?? 0,
    event.created_at,
  );
  return true;
}

/** Settle a first-event read from the same subscription map used for retries. */
export function handleFirstSubscriptionEvent({
  subscriptions,
  subId,
  event,
  closeSubscription,
}: {
  subscriptions: Map<string, RelaySubscription>;
  subId: string;
  event: RelayEvent;
  closeSubscription: (subId: string) => Promise<void>;
}) {
  const subscription = subscriptions.get(subId);
  if (subscription?.mode !== "first") return;
  window.clearTimeout(subscription.timeout);
  subscriptions.delete(subId);
  void closeSubscription(subId);
  subscription.resolve(event);
}

export function shouldDispatchSubscriptionEvent(
  subscription: Extract<RelaySubscription, { mode: "live" }>,
  event: RelayEvent,
) {
  const replay = subscription.reconnectReplay;
  if (replay?.seenEventIds.has(event.id)) return false;
  replay?.seenEventIds.add(event.id);
  return true;
}

export function flushEvents(
  buffer: SubscriptionEventBufferItem[],
  subscriptions: Map<string, RelaySubscription>,
  generation: number,
) {
  for (const item of buffer) {
    const subscription = subscriptions.get(item.subId);
    if (
      subscription?.mode === "live" &&
      item.generation === generation &&
      shouldDispatchSubscriptionEvent(subscription, item.event)
    ) {
      subscription.onEvent(item.event);
    }
  }
}

export function markReconnectLiveEose(
  subscription: Extract<RelaySubscription, { mode: "live" }>,
  generation: number,
) {
  const replay = subscription.reconnectReplay;
  if (!replay || replay.generation !== generation) return;
  replay.liveEose = true;
  if (replay.repairDone) subscription.reconnectReplay = undefined;
}

export function markReconnectRepairDone(
  subscription: Extract<RelaySubscription, { mode: "live" }>,
  generation: number,
) {
  const replay = subscription.reconnectReplay;
  if (!replay || replay.generation !== generation) return;
  replay.repairDone = true;
  if (replay.liveEose) subscription.reconnectReplay = undefined;
}

export function handleSubscriptionEose({
  subscriptions,
  subId,
  closeSubscription,
  generation,
}: {
  subscriptions: Map<string, RelaySubscription>;
  subId: string;
  closeSubscription: (subId: string) => Promise<void>;
  generation?: number;
}) {
  const subscription = subscriptions.get(subId);
  if (!subscription) return;
  if (subscription.mode === "live") {
    if (generation !== undefined)
      markReconnectLiveEose(subscription, generation);
    subscription.resolveReady?.("eose");
    subscription.resolveReady = undefined;
    subscription.closedRetryAttempt = 0;
    clearClosedRetry(subscription);
    return;
  }
  window.clearTimeout(subscription.timeout);
  subscriptions.delete(subId);
  void closeSubscription(subId);
  if (subscription.mode === "first") {
    subscription.resolve(null);
  } else {
    subscription.resolve(sortEvents(subscription.events));
  }
}
