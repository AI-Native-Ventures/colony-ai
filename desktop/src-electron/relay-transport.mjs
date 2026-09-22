// Typed RelayV2 main-side transport adapter (Step 1, no socket yet).
//
// Owns NO child process, NO socket, NO reconnect/backoff, NO subscription
// maps, and NO RelayClient changes. It binds one caller-supplied child
// transport (the existing NativeHost request/lifecycle surface, or a
// mock with the same shape) to the frozen RelayV2 contract in
// relay-protocol.mjs:
//
// - every outbound request context+payload validated BEFORE dispatch;
// - every inbound response/event/frame validated AFTER receipt;
// - registry deadlineMs classes bound to per-request timers;
// - outbound queue bounded by limits.outboundQueueLimit (64);
// - transport generation fenced: stale responses/events discarded;
// - public errors are finite redacted codes only, never payload prose.
//
// The native request/response wire (stdio envelope) is owned by the child
// transport; this adapter owns only RelayV2 semantics on top of it.

import {
  RELAY_V2_LIMITS,
  RELAY_V2_PUBLIC_ERROR_CODES,
  RELAY_V2_REGISTRY_DIGEST,
  RelayProtocolError,
  encodeRelayV2RequestPayload,
  validateRelayV2Context,
  validateRelayV2InboundEvent,
  validateRelayV2InboundFrame,
  validateRelayV2Registry,
  validateRelayV2Response,
} from "./relay-protocol.mjs";

export const RELAY_TRANSPORT_OPERATIONS = Object.freeze([
  "relay-transport/connect",
  "relay-transport/authenticate",
  "relay-transport/subscribe",
  "relay-transport/close_subscription",
  "relay-transport/publish",
  "relay-transport/close",
  "identity-sign/sign_message",
  "identity-sign/sign_presence",
  "identity-sign/sign_typing",
  "identity-sign/sign_user_status",
]);

const KNOWN_TRANSPORT_CODES = [
  ...RELAY_V2_PUBLIC_ERROR_CODES,
  "host_unavailable",
  "queue_full",
  "request_timeout",
  "stale_generation",
  "shutdown",
];

function isKnownTransportCode(code) {
  return typeof code === "string" && KNOWN_TRANSPORT_CODES.includes(code);
}

class RelayTransportError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "RelayTransportError";
    this.code = code;
  }
}

export { RelayTransportError };

function fail(code) {
  throw new RelayTransportError(code);
}

function isFunction(value) {
  return typeof value === "function";
}

/**
 * Return the finite redacted public code for any failure. Relay prose,
 * payload values, and unknown strings never pass through.
 */
export function redactedRelayTransportCode(error) {
  if (error instanceof RelayTransportError) return error.code;
  const code = error instanceof Error ? (error.code ?? error.message) : error;
  if (isKnownTransportCode(code)) {
    if (code === "unsupported_message_type") return "invalid_payload";
    return code;
  }
  if (error instanceof RelayProtocolError) return "invalid_payload";
  return "host_unavailable";
}

function defaultNow() {
  return Date.now();
}

/**
 * Typed RelayV2 adapter over a caller-owned child transport.
 *
 * child must provide ONE of:
 *   A. request({ capability, method, payload, requestId, deadlineMs })
 *      -> Promise<responsePayload> (mock/test doubles resolve the decoded
 *      response payload directly);
 *   B. request({ capability, method, payload, requestId, deadlineMs })
 *      -> Promise<responseEnvelope> where the envelope is the native
 *      stdio RESPONSE frame ({ type:"RESPONSE", outcome, payload, error })
 *      (real helper path; the adapter unwraps and validates the payload).
 *   onLifecycle(listener) -> unsubscribe
 *   getBindingState() -> { generationId, ... } | null
 *
 * The child owns framing, process lifecycle, and rebind; the adapter owns
 * RelayV2 context validation, registry deadlines, queue bounds, generation
 * fencing, and code redaction.
 */
export class RelayTransport {
  constructor({ child, now = defaultNow, timerImpl = null } = {}) {
    if (!child || typeof child !== "object") {
      throw new TypeError("child transport is required");
    }
    if (!isFunction(child.request)) {
      throw new TypeError("child.request must be a function");
    }
    validateRelayV2Registry();
    this.child = child;
    this.now = now;
    this.timerImpl = timerImpl ?? {
      setTimeout: globalThis.setTimeout.bind(globalThis),
    };
    this.pending = new Map();
    this.eventListeners = new Set();
    this.lifecycleListeners = new Set();
    this.childUnsubscribe = null;
    this.generation = null;
    this.authorityRef = null;
    this.connectionId = null;
    this.disposed = false;
    this.sequence = 0;
  }

  /**
   * Attach to the child lifecycle stream and pin the transport generation
   * from the child's current binding. Must be called before invoke().
   */
  attach({ authorityRef, generationId = null } = {}) {
    if (this.disposed) fail("host_unavailable");
    if (typeof authorityRef !== "string" || authorityRef.length === 0) {
      fail("wrong_authority");
    }
    const binding = isFunction(this.child.getBindingState)
      ? this.child.getBindingState()
      : null;
    const generation = generationId ?? binding?.generationId ?? null;
    if (!Number.isSafeInteger(generation) || generation < 0) {
      fail("invalid_context");
    }
    this.authorityRef = authorityRef;
    this.generation = generation;
    if (this.childUnsubscribe === null && isFunction(this.child.onLifecycle)) {
      this.childUnsubscribe = this.child.onLifecycle((frame) =>
        this.#onChildLifecycle(frame),
      );
    }
    return { authorityRef, generationId: generation };
  }

  /**
   * Detach from the child, fail every pending call exactly once, and drop
   * all listeners. No write-after-detach is possible.
   */
  dispose(reason = "host_unavailable") {
    if (this.disposed) return;
    this.disposed = true;
    const code = redactedRelayTransportCode(reason);
    try {
      this.childUnsubscribe?.();
    } catch {
      // Detach is best-effort; pending settlement below is authoritative.
    }
    this.childUnsubscribe = null;
    this.eventListeners.clear();
    this.lifecycleListeners.clear();
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      try {
        clearTimeout(pending.timer);
      } catch {
        // Timer cleanup is best-effort; rejection below is authoritative.
      }
      pending.reject(new RelayTransportError(code));
    }
  }

  /**
   * Invoke one registry operation. The payload is validated through the
   * frozen contract BEFORE dispatch; the response is validated AFTER.
   */
  async invoke(operation, payload, { deadlineMs, connectionId = null } = {}) {
    if (this.disposed) fail("host_unavailable");
    if (this.generation === null || this.authorityRef === null) {
      fail("invalid_context");
    }
    if (!RELAY_TRANSPORT_OPERATIONS.includes(operation)) {
      fail("invalid_operation");
    }
    const registry = RELAY_V2_LIMITS;
    if (this.pending.size >= registry.outboundQueueLimit) {
      fail("queue_full");
    }
    const context = {
      protocolVersion: 2,
      profile: "relay-v2",
      registryDigest: RELAY_V2_REGISTRY_DIGEST,
      operation,
      capability: operation.split("/")[0],
      authorityRef: this.authorityRef,
    };
    const activeConnection = connectionId ?? this.connectionId;
    if (activeConnection !== null) context.connectionId = activeConnection;
    let encoded;
    try {
      validateRelayV2Context(context);
      encoded = encodeRelayV2RequestPayload(context, payload);
    } catch (error) {
      fail(redactedRelayTransportCode(error));
    }
    const entry = deadlineFor(operation);
    const timeout =
      Number.isSafeInteger(deadlineMs) && deadlineMs > 0
        ? Math.min(deadlineMs, entry)
        : entry;
    const id = `relay-${this.generation}-${this.sequence++}`;
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const timer = this.timerImpl.setTimeout(() => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        reject(new RelayTransportError("request_timeout"));
      }, timeout);
      timer.unref?.();
      const pending = { id, generation, operation, resolve, reject, timer };
      this.pending.set(id, pending);
      let dispatch;
      try {
        dispatch = this.child.request({
          capability: operation.split("/")[0],
          method: operation.split("/")[1],
          payload: JSON.parse(encoded.toString("utf8")),
          requestId: id,
          deadlineMs: timeout,
        });
      } catch (error) {
        this.pending.delete(id);
        try {
          clearTimeout(timer);
        } catch {
          // Timer cleanup is best-effort.
        }
        reject(new RelayTransportError(redactedRelayTransportCode(error)));
        return;
      }
      Promise.resolve(dispatch).then(
        (response) =>
          this.#settleResponse(
            id,
            generation,
            operation,
            response,
            resolve,
            reject,
          ),
        (error) => {
          if (this.pending.get(id) !== pending) return;
          this.pending.delete(id);
          try {
            clearTimeout(timer);
          } catch {
            // Timer cleanup is best-effort.
          }
          reject(new RelayTransportError(redactedRelayTransportCode(error)));
        },
      );
    });
  }

  /**
   * Record the connection id minted by the helper. Required before any
   * non-connect operation; binding is exact-match only.
   */
  bindConnection(connectionId) {
    if (typeof connectionId !== "string" || connectionId.length === 0) {
      fail("invalid_payload");
    }
    this.connectionId = connectionId;
    return connectionId;
  }

  onRelayEvent(listener) {
    if (!isFunction(listener))
      throw new TypeError("listener must be a function");
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onTransportLifecycle(listener) {
    if (!isFunction(listener))
      throw new TypeError("listener must be a function");
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  pendingCount() {
    return this.pending.size;
  }

  #settleResponse(id, generation, operation, response, resolve, reject) {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    const settleFail = (error) => {
      this.pending.delete(id);
      try {
        clearTimeout(pending.timer);
      } catch {
        // Timer cleanup is best-effort.
      }
      reject(
        error instanceof RelayTransportError
          ? error
          : new RelayTransportError(redactedRelayTransportCode(error)),
      );
    };
    if (generation !== this.generation || this.disposed) {
      settleFail(new RelayTransportError("stale_generation"));
      return;
    }
    // Real-helper path: unwrap the native stdio RESPONSE envelope. Mock
    // doubles resolve the decoded payload directly and skip this branch.
    let payload = response;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const frameType = payload.type ?? payload.frame_type;
      if (frameType === "RESPONSE") {
        const outcome = payload.outcome;
        if (outcome === "ok") {
          payload = payload.payload;
        } else if (outcome === "error") {
          settleFail(
            new RelayTransportError(
              redactedRelayTransportCode(
                payload.error?.code ?? "invalid_payload",
              ),
            ),
          );
          return;
        } else {
          settleFail(new RelayTransportError("invalid_payload"));
          return;
        }
      }
    }
    let value;
    try {
      value = validateRelayV2Response(operation, payload);
    } catch (error) {
      settleFail(error);
      return;
    }
    this.pending.delete(id);
    try {
      clearTimeout(pending.timer);
    } catch {
      // Timer cleanup is best-effort.
    }
    resolve(value);
  }

  #onChildLifecycle(frame) {
    if (this.disposed) return;
    const generation =
      frame && typeof frame === "object"
        ? (frame.generationId ?? frame.generation ?? null)
        : null;
    if (generation !== null && generation !== this.generation) return;
    for (const listener of [...this.lifecycleListeners]) {
      try {
        listener(frame);
      } catch {
        // Diagnostic listeners cannot break transport.
      }
    }
    if (frame?.rawFrame instanceof Uint8Array) {
      let event;
      try {
        event = validateRelayV2InboundFrame(frame.rawFrame);
      } catch {
        return;
      }
      if (event.generation !== this.generation) return;
      for (const listener of [...this.eventListeners]) {
        try {
          listener(event);
        } catch {
          // Diagnostic listeners cannot break transport.
        }
      }
      return;
    }
    const messageType = frame?.messageType;
    const payload = frame?.payload;
    if (typeof messageType !== "string" || payload === undefined) return;
    let event;
    try {
      if (frame?.rawFrame instanceof Uint8Array) {
        event = validateRelayV2InboundFrame(frame.rawFrame);
      } else {
        event = validateRelayV2InboundEvent({
          connectionId: frame.connectionId ?? this.connectionId,
          generation: this.generation,
          messageType,
          payload,
        });
      }
    } catch {
      return;
    }
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event);
      } catch {
        // Diagnostic listeners cannot break transport.
      }
    }
  }
}

const OPERATION_DEADLINES = Object.freeze({
  "relay-transport/connect": RELAY_V2_LIMITS.connectDeadlineMs,
  "relay-transport/authenticate": RELAY_V2_LIMITS.authDeadlineMs,
  "relay-transport/subscribe": RELAY_V2_LIMITS.requestDeadlineMs,
  "relay-transport/close_subscription": RELAY_V2_LIMITS.closeDeadlineMs,
  "relay-transport/publish": RELAY_V2_LIMITS.publishOkDeadlineMs,
  "relay-transport/close": RELAY_V2_LIMITS.closeDeadlineMs,
  "identity-sign/sign_message": RELAY_V2_LIMITS.requestDeadlineMs,
  "identity-sign/sign_presence": RELAY_V2_LIMITS.requestDeadlineMs,
  "identity-sign/sign_typing": RELAY_V2_LIMITS.requestDeadlineMs,
  "identity-sign/sign_user_status": RELAY_V2_LIMITS.requestDeadlineMs,
});

function deadlineFor(operation) {
  const deadline = OPERATION_DEADLINES[operation];
  if (!Number.isSafeInteger(deadline) || deadline <= 0)
    fail("invalid_registry");
  return deadline;
}
