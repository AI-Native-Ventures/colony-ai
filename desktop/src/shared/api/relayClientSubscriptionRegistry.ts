import type { RelayEvent } from "@/shared/api/types";
import { clearClosedRetry } from "@/shared/api/relayClosedRecovery";
import type {
  LiveSubscriptionReadiness,
  RelaySubscription,
  RelaySubscriptionFilter,
} from "@/shared/api/relayClientShared";

export type LiveSubscriptionConsumer = {
  onEvent: (event: RelayEvent) => void;
  onRetryExhausted?: () => void;
  signalReady: (readiness: LiveSubscriptionReadiness) => void;
  rejectReady: (error: Error) => void;
};

export type SharedLiveSubscription = {
  key: string;
  subId: string;
  consumers: Set<LiveSubscriptionConsumer>;
  readiness?: LiveSubscriptionReadiness;
  active: boolean;
};

type SubscribeSharedLiveFilterInput = {
  registry: Map<string, SharedLiveSubscription>;
  subscriptions: Map<string, RelaySubscription>;
  filter: RelaySubscriptionFilter;
  onEvent: (event: RelayEvent) => void;
  onReady?: (readiness: LiveSubscriptionReadiness) => void;
  readinessTimeoutMs: number;
  onRetryExhausted?: () => void;
  ensureConnected: () => Promise<unknown>;
  sendRequest: (payload: unknown[], failureMessage: string) => Promise<void>;
  closeSubscription: (subId: string) => Promise<void>;
};

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function subscribeSharedLiveFilter({
  registry,
  subscriptions,
  filter,
  onEvent,
  onReady,
  readinessTimeoutMs,
  onRetryExhausted,
  ensureConnected,
  sendRequest,
  closeSubscription,
}: SubscribeSharedLiveFilterInput): Promise<() => Promise<void>> {
  await ensureConnected();
  const key = stableSerialize(filter);
  let shared = registry.get(key);
  const createSubscription = !shared?.active;
  if (createSubscription) {
    shared = {
      key,
      subId: `live-${crypto.randomUUID()}`,
      consumers: new Set(),
      active: true,
    };
    registry.set(key, shared);
    const currentShared = shared;
    subscriptions.set(currentShared.subId, {
      mode: "live",
      filter,
      onEvent: (event) => {
        for (const consumer of [...currentShared.consumers]) {
          consumer.onEvent(event);
        }
      },
      onRetryExhausted: () => {
        currentShared.active = false;
        registry.delete(currentShared.key);
        for (const consumer of [...currentShared.consumers]) {
          consumer.onRetryExhausted?.();
        }
      },
      resolveReady: (readiness) => {
        currentShared.readiness = readiness;
        for (const consumer of [...currentShared.consumers]) {
          consumer.signalReady(readiness);
        }
      },
    });
  }
  if (!shared) throw new Error("Relay subscription setup failed.");

  let readyNotified = false;
  let readyTimer: number | null = null;
  let resolveReady = () => {};
  let rejectReady = (_error: Error) => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const signalReady = (readiness: LiveSubscriptionReadiness) => {
    if (readyNotified) return;
    readyNotified = true;
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    onReady?.(readiness);
    resolveReady();
  };
  const rejectBeforeReady = (error: Error) => {
    if (readyNotified) return;
    readyNotified = true;
    if (readyTimer !== null) window.clearTimeout(readyTimer);
    rejectReady(error);
  };
  const consumer: LiveSubscriptionConsumer = {
    onEvent,
    onRetryExhausted,
    signalReady,
    rejectReady: rejectBeforeReady,
  };
  shared.consumers.add(consumer);
  if (shared.readiness) signalReady(shared.readiness);
  else {
    readyTimer = window.setTimeout(
      () => signalReady("timeout"),
      readinessTimeoutMs,
    );
  }

  try {
    if (createSubscription) {
      await sendRequest(
        ["REQ", shared.subId, filter],
        "Failed to restore relay subscription.",
      );
    }
  } catch (error) {
    shared.active = false;
    registry.delete(shared.key);
    subscriptions.delete(shared.subId);
    for (const sibling of [...shared.consumers]) {
      sibling.rejectReady(
        error instanceof Error ? error : new Error("Relay subscribe failed."),
      );
    }
    throw error;
  }
  await ready;

  return async () => {
    if (!shared.consumers.delete(consumer) || shared.consumers.size > 0) return;
    if (registry.get(shared.key) === shared) registry.delete(shared.key);
    shared.active = false;
    const active = subscriptions.get(shared.subId);
    if (active?.mode !== "live") return;
    subscriptions.delete(shared.subId);
    clearClosedRetry(active);
    await closeSubscription(shared.subId);
  };
}
