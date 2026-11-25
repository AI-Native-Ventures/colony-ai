/**
 * Renderer-wide admission control for authenticated relay HTTP requests.
 *
 * The relay applies one per-principal HTTP allowance across its HTTP routes.
 * Keeping this queue here means independent desktop features cannot turn a
 * screen transition into a fixed-window request burst. A relay 429 also holds
 * every caller until its retry window clears.
 */

export const RELAY_HTTP_REQUEST_BUDGET = 240;
export const RELAY_HTTP_BUDGET_WINDOW_MS = 60_000;
export const RELAY_HTTP_REQUEST_BURST_ALLOWANCE = 30;
export const MAX_RELAY_HTTP_QUEUE = RELAY_HTTP_REQUEST_BUDGET;
export const MAX_RELAY_HTTP_RETRY_SECONDS = 300;

const DEFAULT_RETRY_SECONDS = 10;

type TimerId = number;

type Scheduler = Readonly<{
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerId;
  clearTimeout: (timer: TimerId) => void;
}>;

type QueuedRequest = Readonly<{
  reject: (error: Error) => void;
  resolve: () => void;
}>;

type GateOptions = Readonly<{
  budget?: number;
  burstAllowance?: number;
  maxQueue?: number;
  scheduler?: Scheduler;
  windowMs?: number;
}>;

function browserScheduler(): Scheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
}

/** The request belongs to a community that was replaced before it could send. */
export class RelayHttpRequestSupersededError extends Error {
  constructor() {
    super("Relay HTTP request was superseded before sending.");
    this.name = "RelayHttpRequestSupersededError";
  }
}

/** The relay refused a request because its shared HTTP allowance is busy. */
export class RelayHttpRateLimitError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "RelayHttpRateLimitError";
  }
}

export function isRelayHttpRateLimitError(
  error: unknown,
): error is RelayHttpRateLimitError {
  return error instanceof RelayHttpRateLimitError;
}

/**
 * Extracts a relay retry hint from either the relay's JSON message or another
 * user-safe response string.
 */
export function parseRelayHttpRetryHint(message: string): number | null {
  const match = /retry in (\d+)s/iu.exec(message);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

/** Parses Retry-After seconds or a valid HTTP date into a bounded delay. */
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds), MAX_RELAY_HTTP_RETRY_SECONDS);
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(
    Math.max(1, Math.ceil((at - now) / 1_000)),
    MAX_RELAY_HTTP_RETRY_SECONDS,
  );
}

/**
 * A bounded, FIFO request queue. It admits a small startup burst, then
 * replenishes admission credit at the configured budget rate. A timestamped
 * rolling window is the final ceiling, so a burst never increases the total
 * number of starts permitted in any local budget window. A server backoff
 * supersedes local scheduling until the final retry window expires.
 */
export class RelayHttpRequestGate {
  private readonly budget: number;
  private readonly burstAllowance: number;
  private readonly maxQueue: number;
  private readonly scheduler: Scheduler;
  private readonly windowMs: number;
  private readonly waiters: QueuedRequest[] = [];
  private readonly changeListeners = new Set<() => void>();
  private readonly recoveryListeners = new Set<() => void>();
  private readonly requestStartedAt: number[] = [];
  private availableCredit: number;
  private creditUpdatedAt: number;
  private retryUntil = 0;
  private timer: TimerId | null = null;

  constructor(options: GateOptions = {}) {
    this.budget = options.budget ?? RELAY_HTTP_REQUEST_BUDGET;
    this.burstAllowance = Math.min(
      options.burstAllowance ?? RELAY_HTTP_REQUEST_BURST_ALLOWANCE,
      this.budget,
    );
    this.maxQueue = options.maxQueue ?? MAX_RELAY_HTTP_QUEUE;
    this.scheduler = options.scheduler ?? browserScheduler();
    this.windowMs = options.windowMs ?? RELAY_HTTP_BUDGET_WINDOW_MS;
    const now = this.scheduler.now();
    this.availableCredit = this.burstAllowance;
    this.creditUpdatedAt = now;
  }

  acquire(): Promise<void> {
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new Error("Relay HTTP request queue is full."));
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drain();
    });
  }

  /** Holds later requests for a bounded server-provided retry interval. */
  rateLimited(retryInSeconds: number | null): void {
    const seconds = Math.min(
      Math.max(1, retryInSeconds ?? DEFAULT_RETRY_SECONDS),
      MAX_RELAY_HTTP_RETRY_SECONDS,
    );
    const until = this.scheduler.now() + seconds * 1_000;
    if (until <= this.retryUntil) return;
    this.retryUntil = until;
    this.notifyChanged();
    this.drain();
  }

  isRateLimited(): boolean {
    this.finishRetryWindowIfReady();
    return this.retryUntil > this.scheduler.now();
  }

  remainingRetryMs(): number {
    this.finishRetryWindowIfReady();
    return Math.max(0, this.retryUntil - this.scheduler.now());
  }

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  subscribeToRecovery(listener: () => void): () => void {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  }

  /** Clears a community-scoped queue without reporting it as a recovery. */
  reset(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    const error = new RelayHttpRequestSupersededError();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    const now = this.scheduler.now();
    this.requestStartedAt.splice(0);
    this.availableCredit = this.burstAllowance;
    this.creditUpdatedAt = now;
    this.retryUntil = 0;
    this.notifyChanged();
  }

  private refreshAdmissionState(now: number): void {
    const windowStart = now - this.windowMs;
    while (this.requestStartedAt[0] !== undefined) {
      if ((this.requestStartedAt[0] ?? now) > windowStart) break;
      this.requestStartedAt.shift();
    }

    const elapsedMs = Math.max(0, now - this.creditUpdatedAt);
    if (elapsedMs === 0) return;
    this.availableCredit = Math.min(
      this.burstAllowance,
      this.availableCredit + (elapsedMs * this.budget) / this.windowMs,
    );
    this.creditUpdatedAt = now;
  }

  private finishRetryWindowIfReady(): void {
    if (this.retryUntil === 0 || this.scheduler.now() < this.retryUntil) {
      return;
    }
    this.retryUntil = 0;
    this.notifyChanged();
    for (const listener of [...this.recoveryListeners]) listener();
  }

  private nextAllowedAt(now: number): number {
    this.refreshAdmissionState(now);
    const budgetAt =
      this.requestStartedAt.length >= this.budget
        ? (this.requestStartedAt[0] ?? now) + this.windowMs
        : now;
    const creditAt =
      this.availableCredit >= 1
        ? now
        : now +
          Math.ceil(((1 - this.availableCredit) * this.windowMs) / this.budget);
    return Math.max(this.retryUntil, creditAt, budgetAt);
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
    }
    this.timer = this.scheduler.setTimeout(
      () => {
        this.timer = null;
        this.drain();
      },
      Math.max(1, delayMs),
    );
  }

  private drain(): void {
    this.finishRetryWindowIfReady();
    const now = this.scheduler.now();

    if (this.waiters.length === 0) {
      if (this.retryUntil > now) this.schedule(this.retryUntil - now);
      return;
    }

    while (this.waiters.length > 0) {
      const allowedAt = this.nextAllowedAt(now);
      if (allowedAt > now) {
        this.schedule(allowedAt - now);
        return;
      }
      const waiter = this.waiters.shift();
      if (!waiter) return;
      this.availableCredit -= 1;
      this.requestStartedAt.push(now);
      waiter.resolve();
    }
  }

  private notifyChanged(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}

let activeGate = new RelayHttpRequestGate();

/**
 * Synthetic browser tests use an in-memory relay and must not accumulate
 * production pacing delays while they exercise unrelated routes. Dedicated
 * pacing tests opt in through the existing bridge flag; real relays always
 * remain gated.
 */
export function shouldPaceRelayHttpRequests(): boolean {
  return !(
    typeof window !== "undefined" &&
    window.__BUZZ_E2E_USES_REAL_RELAY__ === false &&
    window.__BUZZ_E2E_FORCE_RELAY_PACING__ !== true
  );
}

export function acquireRelayHttpRequest(): Promise<void> {
  if (!shouldPaceRelayHttpRequests()) return Promise.resolve();
  return activeGate.acquire();
}

export function isRelayHttpRateLimited(): boolean {
  return activeGate.isRateLimited();
}

export function relayHttpRetryRemainingMs(): number {
  return activeGate.remainingRetryMs();
}

export function subscribeToRelayHttpRateLimit(
  listener: () => void,
): () => void {
  return activeGate.subscribe(listener);
}

export function subscribeToRelayHttpRateLimitRecovery(
  listener: () => void,
): () => void {
  return activeGate.subscribeToRecovery(listener);
}

/** Arms the shared gate from an HTTP 429 body and/or Retry-After header. */
export function noteRelayHttpRateLimit(
  response: Pick<Response, "headers" | "status">,
  message = "",
): boolean {
  if (response.status !== 429 || !shouldPaceRelayHttpRequests()) return false;
  const hint = parseRelayHttpRetryHint(message);
  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  activeGate.rateLimited(
    Math.max(hint ?? 0, retryAfter ?? 0) || DEFAULT_RETRY_SECONDS,
  );
  return true;
}

/** Converts a handled 429 into the typed error React Query recovery recognizes. */
export function relayHttpRateLimitError(
  response: Pick<Response, "headers" | "status">,
  message: string,
): RelayHttpRateLimitError {
  noteRelayHttpRateLimit(response, message);
  return new RelayHttpRateLimitError(message);
}

type RequestInitFactory =
  | RequestInit
  | (() => RequestInit | Promise<RequestInit>);

/**
 * Sends one relay HTTP request after its shared budget slot is available.
 *
 * An init factory runs after the wait, so NIP-98 headers are fresh even when a
 * prior 429 held the request for a long retry interval.
 */
export async function fetchRelayHttp(
  input: RequestInfo | URL,
  init: RequestInitFactory,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  await acquireRelayHttpRequest();
  const requestInit = typeof init === "function" ? await init() : init;
  const response = await fetcher(input, requestInit);
  if (response.status === 429) {
    // Reading a clone keeps the caller's JSON/body parser intact while giving
    // the shared queue the relay's more precise "retry in Ns" body hint.
    const message = await response
      .clone()
      .text()
      .catch(() => "");
    noteRelayHttpRateLimit(response, message);
  }
  return response;
}

/** Resets all local HTTP admission state at the canonical community boundary. */
export function resetRelayHttpRequestGate(): void {
  activeGate.reset();
}

/** Test-only seam for exercising a custom clock without changing production state. */
export function _testSetRelayHttpRequestGate(gate: RelayHttpRequestGate): void {
  activeGate.reset();
  activeGate = gate;
}
