const RELAY_ADMISSION_FRAME_TYPES = new Set(["REQ", "COUNT", "EVENT"]);
const RELAY_OPERATION_INTERVAL_MS = 125;
// The relay's default shared WS budget is 50 operations per five seconds.
// An eight-operation burst plus an eight-per-second refill stays below that
// fixed-window budget while allowing initial app subscriptions to start at once.
const RELAY_OPERATION_BURST_CAPACITY = 8;
// Persistable EVENT attempts also consume the relay's 60-per-minute message
// quota. A four-event burst plus one event every 1.2 seconds tops out at 53 in
// any 60-second window, below the relay limit.
const HUMAN_MESSAGE_BURST_CAPACITY = 4;
const HUMAN_MESSAGE_INTERVAL_MS = 1_200;
// Business record commands (a saved lead, client, invoice and the like) draw
// on the relay's separate record allowance of 600 per minute, not on the
// message quota. They are paced only by the shared operation budget above: at
// most eight a second, 480 a minute.
//
// Must list the same kinds as `is_business_command_kind` in
// crates/buzz-core/src/kind.rs: the relay decides which allowance an event
// draws on, and a kind missing there is still held to 60 per minute.
const BUSINESS_RECORD_COMMAND_KINDS: ReadonlySet<number> = new Set([
  47000, // party action
  47001, // client action
  47002, // service action
  47003, // proposal version
  47004, // proposal acceptance
  47006, // work item action
  47007, // deliverable version
  47008, // deliverable approval
  47026, // invoice version
  47027, // payment
  47028, // money adjustment
  47030, // money follow-up
  47034, // prospect action
  47041, // company work tracking action
  47070, // qualify observation action
  47075, // outreach list action
  47076, // discovery campaign action
]);
const MAX_QUEUED_RELAY_OPERATIONS = 256;

type PacerState = {
  tokens: number;
  lastRefillAt: number;
  humanMessageTokens: number;
  lastHumanMessageRefillAt: number;
  /** Set once this relay refused a record command for its rate. */
  recordCommandsUseMessageQuota: boolean;
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
  humanMessage: boolean;
  isCurrent: () => boolean;
  minimumDelayMs: () => number;
  resolve: () => void;
  reject: (error: Error) => void;
};

function createPacerState(): PacerState {
  return {
    tokens: RELAY_OPERATION_BURST_CAPACITY,
    lastRefillAt: Date.now(),
    humanMessageTokens: HUMAN_MESSAGE_BURST_CAPACITY,
    lastHumanMessageRefillAt: Date.now(),
    recordCommandsUseMessageQuota: false,
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

function persistedEventKind(frame: unknown[]): number | null {
  if (frame[0] !== "EVENT" || typeof frame[1] !== "object" || !frame[1]) {
    return null;
  }
  const kind = (frame[1] as { kind?: unknown }).kind;
  return typeof kind === "number" && (kind < 20_000 || kind > 29_999)
    ? kind
    : null;
}

/** Whether `kind` is a business record command, which the relay counts apart from chat. */
export function isBusinessRecordCommandKind(kind: number): boolean {
  return BUSINESS_RECORD_COMMAND_KINDS.has(kind);
}

function drawsOnMessageQuota(state: PacerState, frame: unknown[]): boolean {
  const kind = persistedEventKind(frame);
  if (kind === null) return false;
  return (
    state.recordCommandsUseMessageQuota || !isBusinessRecordCommandKind(kind)
  );
}

/**
 * Fall back to message pacing for record commands after the relay refused one
 * for its rate.
 *
 * A relay without the separate record allowance counts every saved record
 * against the 60-per-minute message quota. Sending records faster than that
 * would be refused again and again, so from the first refusal until the next
 * community switch they are paced like messages.
 */
export function paceRecordCommandsAsMessages(): void {
  activeState.recordCommandsUseMessageQuota = true;
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
  const elapsedMessageMs = Math.max(0, now - state.lastHumanMessageRefillAt);
  state.humanMessageTokens = Math.min(
    HUMAN_MESSAGE_BURST_CAPACITY,
    state.humanMessageTokens + elapsedMessageMs / HUMAN_MESSAGE_INTERVAL_MS,
  );
  state.lastHumanMessageRefillAt = now;
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

  for (let index = state.waiters.length - 1; index >= 0; index--) {
    const operation = state.waiters[index];
    if (!operation.isCurrent()) {
      state.waiters.splice(index, 1);
      operation.reject(
        new Error("Relay operation was superseded before sending."),
      );
    }
  }

  while (state.waiters.length > 0) {
    let selectedIndex = -1;
    let nextReadyInMs = Number.POSITIVE_INFINITY;
    for (let index = 0; index < state.waiters.length; index++) {
      const operation = state.waiters[index];
      const tokenDelayMs = Math.ceil(
        Math.max(0, 1 - state.tokens) * RELAY_OPERATION_INTERVAL_MS,
      );
      const messageDelayMs = operation.humanMessage
        ? Math.ceil(
            Math.max(0, 1 - state.humanMessageTokens) *
              HUMAN_MESSAGE_INTERVAL_MS,
          )
        : 0;
      const delayMs = Math.max(
        tokenDelayMs,
        messageDelayMs,
        Math.max(0, operation.minimumDelayMs()),
      );
      if (delayMs === 0) {
        selectedIndex = index;
        break;
      }
      nextReadyInMs = Math.min(nextReadyInMs, delayMs);
    }
    if (selectedIndex < 0) {
      scheduleRefill(state, nextReadyInMs);
      return;
    }

    const operation = state.waiters.splice(selectedIndex, 1)[0];
    if (!operation) break;
    state.tokens -= 1;
    if (operation.humanMessage) state.humanMessageTokens -= 1;
    operation.resolve();
  }
  if (state.waiters.length === 0 && state.refillTimer !== null) {
    window.clearTimeout(state.refillTimer);
    state.refillTimer = null;
  }
}

function acquireToken(
  state: PacerState,
  priority: RelayOperationPriority,
  isCurrent: () => boolean,
  minimumDelayMs: () => number,
  humanMessage: boolean,
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
      humanMessage,
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
  await acquireToken(
    state,
    priority,
    isCurrent,
    minimumDelayMs,
    drawsOnMessageQuota(state, frame),
  );
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
