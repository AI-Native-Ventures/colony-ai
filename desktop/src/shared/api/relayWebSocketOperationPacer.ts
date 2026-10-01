const RELAY_ADMISSION_FRAME_TYPES = new Set(["REQ", "COUNT", "EVENT"]);
const RELAY_OPERATION_INTERVAL_MS = 125;
// The relay's default shared WS budget is 50 operations per five seconds.
// An eight-operation burst plus an eight-per-second refill stays below that
// fixed-window budget while allowing initial app subscriptions to start at once.
const RELAY_OPERATION_BURST_CAPACITY = 8;
const MAX_QUEUED_RELAY_OPERATIONS = 256;

type PacerState = {
  tokens: number;
  lastRefillAt: number;
  nextSequence: number;
  waiters: QueuedOperation[];
  refillTimer: number | null;
};

type RelayOperationPriority =
  | "background"
  | "normal"
  | "visible"
  | "interactive";

type QueuedOperation = {
  sequence: number;
  priority: RelayOperationPriority;
  isCurrent: () => boolean;
  minimumDelayMs: () => number;
  resolve: () => void;
  reject: (error: Error) => void;
};

function createPacerState(): PacerState {
  return {
    tokens: RELAY_OPERATION_BURST_CAPACITY,
    lastRefillAt: Date.now(),
    nextSequence: 0,
    waiters: [],
    refillTimer: null,
  };
}

let activeState = createPacerState();

function isAdmissionFrame(frame: unknown[]): boolean {
  return (
    typeof frame[0] === "string" && RELAY_ADMISSION_FRAME_TYPES.has(frame[0])
  );
}

function isSyntheticE2eRelay(): boolean {
  return (
    typeof window !== "undefined" &&
    window.__BUZZ_E2E_USES_REAL_RELAY__ === false &&
    window.__BUZZ_E2E_FORCE_RELAY_PACING__ !== true
  );
}

function refillTokens(state: PacerState, now: number): void {
  const elapsedMs = Math.max(0, now - state.lastRefillAt);
  state.tokens = Math.min(
    RELAY_OPERATION_BURST_CAPACITY,
    state.tokens + elapsedMs / RELAY_OPERATION_INTERVAL_MS,
  );
  state.lastRefillAt = now;
}

const PRIORITY_RANK: Record<RelayOperationPriority, number> = {
  background: 0,
  normal: 1,
  visible: 2,
  interactive: 3,
};

function scheduleRefill(state: PacerState, minimumDelayMs = 0): void {
  if (state.refillTimer !== null || state.waiters.length === 0) return;
  refillTokens(state, Date.now());
  const tokenDelayMs = Math.ceil(
    Math.max(0, 1 - state.tokens) * RELAY_OPERATION_INTERVAL_MS,
  );
  const delayMs = Math.max(minimumDelayMs, tokenDelayMs);
  state.refillTimer = window.setTimeout(
    () => {
      state.refillTimer = null;
      drainQueue(state);
    },
    Math.max(1, delayMs),
  );
}

function drainQueue(state: PacerState): void {
  if (state !== activeState) return;
  refillTokens(state, Date.now());
  state.waiters.sort(
    (left, right) =>
      PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] ||
      left.sequence - right.sequence,
  );

  while (state.waiters.length > 0) {
    const current = state.waiters[0];
    if (!current.isCurrent()) {
      state.waiters.shift();
      current.reject(
        new Error("Relay operation was superseded before sending."),
      );
      continue;
    }
    const tokenDelayMs = Math.ceil(
      Math.max(0, 1 - state.tokens) * RELAY_OPERATION_INTERVAL_MS,
    );
    const minimumDelayMs = Math.max(0, current.minimumDelayMs());
    if (state.tokens < 1 || minimumDelayMs > 0) {
      scheduleRefill(state, Math.max(tokenDelayMs, minimumDelayMs));
      return;
    }
    const operation = state.waiters.shift();
    if (!operation) break;
    state.tokens -= 1;
    operation.resolve();
  }
}

function acquireToken(
  state: PacerState,
  priority: RelayOperationPriority,
  isCurrent: () => boolean,
  minimumDelayMs: () => number,
): Promise<void> {
  if (state !== activeState) {
    return Promise.reject(
      new Error("Relay operation was superseded before sending."),
    );
  }
  if (state.waiters.length >= MAX_QUEUED_RELAY_OPERATIONS) {
    return Promise.reject(new Error("Relay outbound operation queue is full."));
  }

  return new Promise((resolve, reject) => {
    state.waiters.push({
      sequence: state.nextSequence++,
      priority,
      isCurrent,
      minimumDelayMs,
      resolve,
      reject,
    });
    drainQueue(state);
  });
}

/**
 * Send one Nostr operation through a renderer-wide rate pacer.
 *
 * The relay budgets authenticated REQ, COUNT, and EVENT frames per pubkey,
 * across sockets. A renderer-wide queue prevents concurrent clients and
 * startup subscriptions from turning into a single fixed-window burst.
 */
export async function sendPacedRelayOperation<T>(
  frame: unknown[],
  isCurrent: () => boolean,
  send: () => Promise<T>,
  priority: RelayOperationPriority = "normal",
  minimumDelayMs: () => number = () => 0,
): Promise<T> {
  if (isSyntheticE2eRelay() || !isAdmissionFrame(frame)) {
    if (!isCurrent()) {
      throw new Error("Relay operation was superseded before sending.");
    }
    return send();
  }

  const state = activeState;
  await acquireToken(state, priority, isCurrent, minimumDelayMs);
  if (state !== activeState || !isCurrent()) {
    throw new Error("Relay operation was superseded before sending.");
  }
  return send();
}

/** Reset queued operations at the canonical community switch boundary. */
export function resetRelayWebSocketOperationPacer(): void {
  if (activeState.refillTimer !== null) {
    window.clearTimeout(activeState.refillTimer);
  }
  for (const operation of activeState.waiters) {
    operation.reject(
      new Error("Relay operation was superseded before sending."),
    );
  }
  activeState = createPacerState();
}
