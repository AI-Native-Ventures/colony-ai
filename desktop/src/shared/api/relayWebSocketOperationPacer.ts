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
  queued: number;
  tail: Promise<void>;
};

function createPacerState(): PacerState {
  return {
    tokens: RELAY_OPERATION_BURST_CAPACITY,
    lastRefillAt: Date.now(),
    queued: 0,
    tail: Promise.resolve(),
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
    window.__BUZZ_E2E_USES_REAL_RELAY__ === false
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function refillTokens(state: PacerState, now: number): void {
  const elapsedMs = Math.max(0, now - state.lastRefillAt);
  state.tokens = Math.min(
    RELAY_OPERATION_BURST_CAPACITY,
    state.tokens + elapsedMs / RELAY_OPERATION_INTERVAL_MS,
  );
  state.lastRefillAt = now;
}

function acquireToken(state: PacerState): Promise<void> | null {
  if (state !== activeState) {
    throw new Error("Relay operation was superseded before sending.");
  }

  const now = Date.now();
  refillTokens(state, now);
  if (state.tokens >= 1) {
    state.tokens -= 1;
    return null;
  }

  const delayMs = Math.ceil((1 - state.tokens) * RELAY_OPERATION_INTERVAL_MS);
  return wait(Math.max(1, delayMs)).then(() => {
    const retry = acquireToken(state);
    return retry ?? undefined;
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
): Promise<T> {
  if (isSyntheticE2eRelay() || !isAdmissionFrame(frame)) {
    if (!isCurrent()) {
      throw new Error("Relay operation was superseded before sending.");
    }
    return send();
  }

  const state = activeState;
  if (state.queued >= MAX_QUEUED_RELAY_OPERATIONS) {
    throw new Error("Relay outbound operation queue is full.");
  }
  state.queued += 1;

  const operation = state.tail.then(async () => {
    if (state !== activeState || !isCurrent()) {
      throw new Error("Relay operation was superseded before sending.");
    }

    const tokenWait = acquireToken(state);
    if (tokenWait) await tokenWait;

    if (state !== activeState || !isCurrent()) {
      throw new Error("Relay operation was superseded before sending.");
    }

    return send();
  });
  state.tail = operation.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await operation;
  } finally {
    state.queued -= 1;
  }
}

/** Reset queued operations at the canonical community switch boundary. */
export function resetRelayWebSocketOperationPacer(): void {
  activeState = createPacerState();
}
