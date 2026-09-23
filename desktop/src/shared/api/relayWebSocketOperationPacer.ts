const RELAY_ADMISSION_FRAME_TYPES = new Set(["REQ", "COUNT", "EVENT"]);
const RELAY_OPERATION_INTERVAL_MS = 125;
const MAX_QUEUED_RELAY_OPERATIONS = 256;

type PacerState = {
  nextSendAt: number;
  queued: number;
  tail: Promise<void>;
};

function createPacerState(): PacerState {
  return {
    nextSendAt: 0,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
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
  if (!isAdmissionFrame(frame)) {
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

    const delayMs = Math.max(0, state.nextSendAt - Date.now());
    if (delayMs > 0) await wait(delayMs);

    if (state !== activeState || !isCurrent()) {
      throw new Error("Relay operation was superseded before sending.");
    }

    state.nextSendAt = Date.now() + RELAY_OPERATION_INTERVAL_MS;
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
