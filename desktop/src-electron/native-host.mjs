import { randomUUID } from "node:crypto";
import { spawn as defaultSpawn } from "node:child_process";

import {
  createBinding,
  createCancel,
  createHello,
  createRehello,
  createRequest,
  encodeFrame,
  FrameDecoder,
  HostProtocolError,
  LIMITS,
  loadManifest,
  redactedProtocolCode,
  REGISTRY_DIGEST,
  validateEnvelope,
  validateHealthRequest,
} from "./host-protocol.mjs";
import {
  IDENTITY_LIMITS,
  IdentityFrameDecoder,
  PRODUCTION_REGISTRY_DIGEST as IDENTITY_REGISTRY_DIGEST,
  createIdentityCancel,
  createIdentityHello,
  createIdentityRehello,
  createIdentityRequest,
  encodeIdentityFrame,
  redactedIdentityProtocolCode,
  validateIdentityLaunchDescriptor,
  validateIdentityResponse,
} from "./identity-protocol.mjs";

const MAX_SEEN_REQUEST_IDS = LIMITS.inFlightLimit * 32;
const ALLOWED_OUTCOMES = new Set([
  "ok",
  "error",
  "outcome_unknown",
  "cancelled",
]);
const MAX_RETIRED_RESPONSE_SCHEMAS = LIMITS.inFlightLimit * 2;

export class NativeHostError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "NativeHostError";
    this.code = code;
  }
}

function hostError(code) {
  return new NativeHostError(code);
}

function isFunction(value) {
  return typeof value === "function";
}

function settleReject(reject, error) {
  reject(error instanceof Error ? error : hostError("host_unavailable"));
}

function cloneBinding(binding) {
  return binding ? Object.freeze({ ...binding }) : null;
}

/**
 * Owns exactly one private stdio child process for the headless Rust host.
 * The class intentionally exposes only the frozen health-safe registry entry;
 * it is not a generic command tunnel.
 */
export class NativeHost {
  constructor({
    executablePath,
    manifest = loadManifest(),
    profileId,
    sessionId = randomUUID(),
    buildId = `electron-transport-${manifest.sourceRevision.slice(0, 12)}`,
    spawnImpl = defaultSpawn,
    inheritedEnv = process.env,
    spawnEnv = {},
    requestIdFactory = randomUUID,
    identityLaunch = null,
  } = {}) {
    if (typeof executablePath !== "string" || executablePath.length === 0) {
      throw new TypeError("executablePath is required");
    }
    this.manifest = loadManifest(manifest);
    this.protocol = this.manifest.protocol;
    this.identityLaunch = identityLaunch
      ? Object.freeze({ ...validateIdentityLaunchDescriptor(identityLaunch) })
      : null;
    this.identityMode = this.identityLaunch !== null;
    this.executablePath = executablePath;
    const resolvedProfileId =
      profileId ??
      this.identityLaunch?.profileId ??
      this.manifest.namespace.profileId;
    if (
      this.identityMode
        ? resolvedProfileId !== this.identityLaunch.profileId
        : resolvedProfileId !== this.manifest.namespace.profileId
    ) {
      throw new NativeHostError("invalid_profile_id");
    }
    this.profileId = resolvedProfileId;
    this.registryDigest = this.identityMode
      ? IDENTITY_REGISTRY_DIGEST
      : REGISTRY_DIGEST;
    this.limits = this.identityMode ? IDENTITY_LIMITS : this.protocol;
    this.sessionId = sessionId;
    this.buildId = buildId;
    this.spawnImpl = spawnImpl;
    this.inheritedEnv = { ...inheritedEnv };
    this.spawnEnv = { ...spawnEnv };
    this.requestIdFactory = requestIdFactory;

    this.state = "idle";
    this.binding = null;
    this.child = null;
    this.pending = new Map();
    this.retiredResponseSchemas = new Map();
    this.decoder = this.identityMode
      ? new IdentityFrameDecoder({
          direction: "host",
          frameLimitBytes: this.limits.frameLimitBytes,
          responseContext: (requestId) => this.#responseContext(requestId),
        })
      : new FrameDecoder({
          direction: "host",
          frameLimitBytes: this.limits.frameLimitBytes,
        });
    this.seenRequestIds = new Set();
    this.outboundQueue = [];
    this.writing = false;
    this.lifecycleBuffer = [];
    this.lifecycleListeners = new Set();
    this.stateListeners = new Set();
    this.startPromise = null;
    this.startResolve = null;
    this.startReject = null;
    this.startTimer = null;
    this.rebindWait = null;
    this.rebindTimer = null;
    this.disposePromise = null;
    this.disposeResolve = null;
    this.exitObserved = false;
    this.terminalError = null;
    this.terminal = false;
    this.sequenceByGeneration = new Map();
  }

  async start() {
    if (this.state === "ready") return cloneBinding(this.binding);
    if (this.startPromise) return this.startPromise;
    if (this.terminal || this.state === "closing") {
      throw this.terminalError ?? hostError("host_unavailable");
    }
    this.state = "starting";
    this.#notifyState();
    this.startPromise = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    try {
      const environment = { ...this.inheritedEnv, ...this.spawnEnv };
      this.child = this.spawnImpl(
        this.executablePath,
        this.identityMode ? ["--identity-v2"] : [],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: environment,
        },
      );
      this.#attachChild(this.child);
      this.startTimer = setTimeout(() => {
        if (this.state === "starting") this.#fatal("startup_timeout");
      }, this.limits.defaultDeadlineMs);
      this.startTimer.unref?.();
      this.#enqueue(
        this.identityMode
          ? createIdentityHello({
              profileId: this.profileId,
              sessionId: this.sessionId,
              buildId: this.buildId,
              identityLaunch: this.identityLaunch,
            })
          : createHello({
              profileId: this.profileId,
              sessionId: this.sessionId,
              buildId: this.buildId,
            }),
      );
    } catch {
      this.#fatal("host_unavailable");
    }
    return this.startPromise;
  }

  async request({
    capability = "health-safe",
    method = "get_default_relay_url",
    payload = {},
    requestId = null,
    deadlineMs,
    generationId = null,
  } = {}) {
    if (this.state !== "ready" || !this.binding) {
      throw hostError(
        this.state === "rebinding" ? "renderer_rebinding" : "host_unavailable",
      );
    }
    if (!this.identityMode) {
      validateHealthRequest({ capability, method, payload });
    }
    if (generationId !== null && generationId !== this.binding.generationId) {
      throw hostError("stale_generation");
    }
    if (this.pending.size >= this.limits.inFlightLimit) {
      throw hostError("host_busy");
    }
    const id = requestId ?? this.requestIdFactory();
    if (this.seenRequestIds.has(id)) {
      throw hostError("duplicate_request_id");
    }
    if (this.seenRequestIds.size >= MAX_SEEN_REQUEST_IDS) {
      throw hostError("host_busy");
    }
    const safeDeadline =
      Number.isSafeInteger(deadlineMs) && deadlineMs > 0
        ? Math.min(deadlineMs, this.limits.defaultDeadlineMs)
        : this.limits.defaultDeadlineMs;
    let frame;
    try {
      frame = this.identityMode
        ? createIdentityRequest({
            profileId: this.binding.profileId,
            sessionId: this.binding.sessionId,
            generationId: this.binding.generationId,
            requestId: id,
            capability,
            method,
            payload,
          })
        : createRequest({
            profileId: this.binding.profileId,
            sessionId: this.binding.sessionId,
            generationId: this.binding.generationId,
            requestId: id,
            capability,
            method,
            payload,
          });
    } catch (error) {
      throw hostError(this.#redactedCode(error));
    }
    this.seenRequestIds.add(id);
    const promise = new Promise((resolve, reject) => {
      const pending = {
        generationId: this.binding.generationId,
        capability,
        method,
        resolve,
        reject,
        timer: null,
      };
      pending.timer = setTimeout(() => {
        if (this.pending.get(id) !== pending) return;
        this.pending.delete(id);
        this.#retireResponseSchema(id, pending);
        this.#sendCancelBestEffort(id, pending.generationId);
        reject(hostError("timeout"));
      }, safeDeadline);
      pending.timer.unref?.();
      this.pending.set(id, pending);
      try {
        this.#enqueue(frame);
      } catch (error) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.#retireResponseSchema(id, pending);
        reject(
          error instanceof Error ? error : hostError("outbound_queue_full"),
        );
      }
    });
    return promise;
  }

  async requestHealthSafe(options = {}) {
    return this.request({
      ...options,
      capability: "health-safe",
      method: "get_default_relay_url",
      payload: {},
    });
  }

  rebind(generationId) {
    if (this.state !== "ready" || !this.binding) {
      return Promise.reject(hostError("host_unavailable"));
    }
    if (!Number.isSafeInteger(generationId) || generationId <= 0) {
      return Promise.reject(hostError("invalid_generation_id"));
    }
    if (generationId === this.binding.generationId) {
      return Promise.resolve(cloneBinding(this.binding));
    }
    if (generationId !== this.binding.generationId + 1) {
      return Promise.reject(hostError("invalid_generation_id"));
    }
    if (this.rebindWait) {
      return Promise.reject(hostError("rebind_in_progress"));
    }
    const nextBinding = createBinding({
      profileId: this.binding.profileId,
      sessionId: this.binding.sessionId,
      generationId,
    });
    this.state = "rebinding";
    this.#notifyState();
    const promise = new Promise((resolve, reject) => {
      this.rebindWait = { generationId, nextBinding, resolve, reject };
      this.rebindTimer = setTimeout(() => {
        if (!this.rebindWait || this.rebindWait.generationId !== generationId)
          return;
        this.rebindWait = null;
        this.rebindTimer = null;
        this.#fatal("rebind_timeout");
      }, this.limits.rebindAckDeadlineMs);
      this.rebindTimer.unref?.();
      try {
        this.#enqueue(
          this.identityMode
            ? createIdentityRehello({
                profileId: this.binding.profileId,
                sessionId: this.binding.sessionId,
                generationId,
                buildId: this.buildId,
              })
            : createRehello({
                profileId: this.binding.profileId,
                sessionId: this.binding.sessionId,
                generationId,
                buildId: this.buildId,
              }),
        );
      } catch (error) {
        clearTimeout(this.rebindTimer);
        this.rebindTimer = null;
        this.rebindWait = null;
        reject(
          error instanceof Error ? error : hostError("outbound_queue_full"),
        );
        this.#fatal(this.#redactedCode(error, "outbound_queue_full"));
      }
    });
    return promise;
  }

  onLifecycle(listener) {
    if (!isFunction(listener))
      throw new TypeError("listener must be a function");
    if (this.terminal) return () => {};
    if (
      this.lifecycleListeners.size >= (this.protocol.subscriptionLimit ?? 1024)
    ) {
      throw hostError("host_busy");
    }
    this.lifecycleListeners.add(listener);
    const buffered = this.lifecycleBuffer.splice(0);
    for (const frame of buffered) {
      if (this.binding && frame.generationId !== this.binding.generationId)
        continue;
      this.#deliverLifecycle(listener, frame);
    }
    return () => this.lifecycleListeners.delete(listener);
  }

  onState(listener) {
    if (!isFunction(listener))
      throw new TypeError("listener must be a function");
    if (this.terminal) {
      try {
        listener(this.getBindingState());
      } catch {
        // State observers are diagnostic only and cannot break transport.
      }
      return () => {};
    }
    this.stateListeners.add(listener);
    try {
      listener(this.getBindingState());
    } catch {
      // State observers are diagnostic only and cannot break transport.
    }
    return () => this.stateListeners.delete(listener);
  }

  getBindingState() {
    return Object.freeze({
      state: this.state,
      profileId: this.binding?.profileId ?? this.profileId,
      sessionId: this.binding?.sessionId ?? this.sessionId,
      generationId: this.binding?.generationId ?? null,
      registryDigest: this.binding ? this.registryDigest : null,
    });
  }

  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    if (this.state === "closed" && !this.child) return;
    if (!this.terminal) {
      this.terminal = true;
      this.terminalError = hostError("host_disposed");
    }
    this.outboundQueue = [];
    this.writing = false;
    this.state = "closing";
    this.#notifyState();
    this.#settlePending(hostError("host_disposed"));
    if (this.startReject) {
      this.startReject(hostError("host_disposed"));
      this.startResolve = null;
      this.startReject = null;
    }
    if (this.rebindWait) {
      this.rebindWait.reject(hostError("host_disposed"));
      this.rebindWait = null;
    }
    if (!this.child) {
      this.state = "closed";
      this.#notifyState();
      this.#clearObservers();
      return;
    }
    this.disposePromise = new Promise((resolve) => {
      this.disposeResolve = resolve;
      try {
        this.child.stdin?.end?.();
      } catch {
        // A closed pipe is already on the bounded shutdown path.
      }
      const timer = setTimeout(() => {
        if (!this.exitObserved) {
          try {
            this.child?.kill?.();
          } catch {
            // Process exit remains the final bounded cleanup boundary.
          }
        }
        this.#finishDispose();
      }, this.limits.shutdownGraceMs);
      timer.unref?.();
      this.disposeTimer = timer;
      if (this.exitObserved) this.#finishDispose();
    });
    return this.disposePromise;
  }

  #attachChild(child) {
    if (!child?.stdin || !child.stdout) {
      throw hostError("host_unavailable");
    }
    child.stdout.on("data", (chunk) => this.#receive(chunk));
    child.stdout.on("end", () => this.#onPipeEnd());
    child.stdout.on("error", () => this.#fatal("host_unavailable"));
    child.stdin.on?.("drain", () => {
      if (
        this.terminal ||
        this.state === "closing" ||
        this.state === "closed"
      ) {
        this.writing = false;
        this.outboundQueue = [];
        return;
      }
      this.writing = false;
      this.#pumpOutbound();
    });
    child.stdin.on?.("error", () => this.#fatal("host_unavailable"));
    // Native stderr is intentionally consumed and never emitted: protocol
    // payloads and process diagnostics must not leak into renderer logs.
    child.stderr?.on?.("data", () => {});
    child.stderr?.on?.("error", () => {});
    child.on?.("error", () => this.#fatal("host_unavailable"));
    child.on?.("exit", () => this.#onExit());
    child.on?.("close", () => this.#onExit());
  }

  #receive(chunk) {
    if (this.terminal) return;
    try {
      for (const frame of this.decoder.push(chunk)) {
        this.#handleFrame(frame);
        if (this.terminal) break;
      }
    } catch (error) {
      this.#fatal(this.#redactedCode(error));
    }
  }

  #handleFrame(frame) {
    if (this.terminal) return;
    if (this.identityMode) {
      this.#handleIdentityFrame(frame);
      return;
    }
    try {
      validateEnvelope(frame, { direction: "host", binding: this.binding });
    } catch (error) {
      this.#fatal(redactedProtocolCode(error));
      return;
    }
    if (frame.type === "READY") {
      this.#handleReady(frame);
      return;
    }
    if (frame.type === "REBOUND") {
      this.#handleRebound(frame);
      return;
    }
    if (!this.binding) {
      this.#fatal("wrong_binding");
      return;
    }
    if (frame.type === "RESPONSE") {
      this.#handleResponse(frame);
      return;
    }
    this.#handleEvent(frame);
  }

  #handleIdentityFrame(frame) {
    if (frame.type === "READY") {
      this.#handleReady(frame);
      return;
    }
    if (frame.type === "REBOUND") {
      this.#handleRebound(frame);
      return;
    }
    if (!this.binding) {
      this.#fatal("wrong_binding");
      return;
    }
    if (frame.type === "RESPONSE") {
      this.#handleResponse(frame);
      return;
    }
    this.#handleEvent(frame);
  }

  #handleReady(frame) {
    if (this.state !== "starting" || this.binding) {
      this.#fatal("unexpected_ready");
      return;
    }
    if (
      frame.profileId !== this.profileId ||
      frame.sessionId !== this.sessionId ||
      frame.generationId !== 1 ||
      frame.registryDigest !== this.registryDigest
    ) {
      this.#fatal("wrong_binding");
      return;
    }
    this.binding = createBinding({
      profileId: frame.profileId,
      sessionId: frame.sessionId,
      generationId: frame.generationId,
    });
    this.decoder.setBinding({
      profileId: this.binding.profileId,
      sessionId: this.binding.sessionId,
    });
    this.state = "ready";
    this.#notifyState();
    const resolve = this.startResolve;
    clearTimeout(this.startTimer);
    this.startTimer = null;
    this.startResolve = null;
    this.startReject = null;
    resolve?.(cloneBinding(this.binding));
  }

  #handleRebound(frame) {
    const wait = this.rebindWait;
    if (!wait) {
      if (this.binding && frame.generationId === this.binding.generationId)
        return;
      this.#fatal("unexpected_rebound");
      return;
    }
    if (
      frame.generationId !== wait.generationId ||
      frame.profileId !== wait.nextBinding.profileId ||
      frame.sessionId !== wait.nextBinding.sessionId ||
      frame.registryDigest !== this.registryDigest
    ) {
      this.#fatal("wrong_binding");
      return;
    }
    clearTimeout(this.rebindTimer);
    this.rebindTimer = null;
    this.binding = wait.nextBinding;
    this.decoder.setBinding({
      profileId: this.binding.profileId,
      sessionId: this.binding.sessionId,
    });
    this.#settleOlderPending(
      this.binding.generationId,
      hostError("renderer_rebound"),
    );
    this.rebindWait = null;
    this.state = "ready";
    this.#notifyState();
    wait.resolve(cloneBinding(this.binding));
  }

  #handleResponse(frame) {
    if (frame.generationId !== this.binding.generationId) {
      this.retiredResponseSchemas.delete(frame.requestId);
      return;
    }
    const pending = this.pending.get(frame.requestId);
    if (!pending || pending.generationId !== frame.generationId) {
      this.retiredResponseSchemas.delete(frame.requestId);
      return;
    }
    this.pending.delete(frame.requestId);
    clearTimeout(pending.timer);
    this.#retireResponseSchema(frame.requestId, pending);
    if (this.identityMode) {
      try {
        validateIdentityResponse(frame, {
          binding: this.binding,
          expectedCapability: pending.capability,
          expectedGeneration: pending.generationId,
          expectedMethod: pending.method,
        });
      } catch (error) {
        this.#fatal(this.#redactedCode(error));
        return;
      }
    }
    if (!ALLOWED_OUTCOMES.has(frame.outcome)) {
      pending.reject(hostError("invalid_outcome"));
      return;
    }
    if (frame.outcome === "ok") {
      pending.resolve(frame);
      return;
    }
    pending.reject(hostError(this.#redactedCode(frame.error, frame.outcome)));
  }

  #handleEvent(frame) {
    if (this.terminal || !this.binding) return;
    if (frame.generationId !== this.binding.generationId) return;
    const previous = this.sequenceByGeneration.get(frame.generationId) ?? 0;
    if (frame.sequence <= previous) {
      this.#fatal("invalid_sequence");
      return;
    }
    this.sequenceByGeneration.set(frame.generationId, frame.sequence);
    if (this.lifecycleListeners.size === 0) {
      if (this.lifecycleBuffer.length < 2) this.lifecycleBuffer.push(frame);
      return;
    }
    for (const listener of this.lifecycleListeners) {
      this.#deliverLifecycle(listener, frame);
    }
  }

  #deliverLifecycle(listener, frame) {
    try {
      listener(
        Object.freeze({
          ...frame,
          payload: Object.freeze({ ...frame.payload }),
        }),
      );
    } catch {
      // Listener failures cannot tear down the private transport.
    }
  }

  #enqueue(frame) {
    if (
      this.terminal ||
      this.state === "closing" ||
      this.state === "closed" ||
      !this.child?.stdin
    )
      throw hostError("host_unavailable");
    let bytes;
    try {
      bytes = this.identityMode
        ? encodeIdentityFrame(frame, { direction: "main" })
        : encodeFrame(frame, { direction: "main" });
    } catch (error) {
      throw hostError(this.#redactedCode(error));
    }
    if (this.outboundQueue.length >= this.limits.outboundQueueLimit) {
      this.#fatal("outbound_queue_full");
      throw hostError("outbound_queue_full");
    }
    this.outboundQueue.push(bytes);
    this.#pumpOutbound();
  }

  #pumpOutbound() {
    if (
      this.writing ||
      this.terminal ||
      this.state === "closing" ||
      this.state === "closed"
    ) {
      if (
        this.terminal ||
        this.state === "closing" ||
        this.state === "closed"
      ) {
        this.outboundQueue = [];
      }
      return;
    }
    const bytes = this.outboundQueue.shift();
    if (!bytes) return;
    try {
      const accepted = this.child.stdin.write(bytes);
      if (accepted === false) {
        this.writing = true;
      } else {
        queueMicrotask(() => this.#pumpOutbound());
      }
    } catch {
      this.#fatal("host_unavailable");
    }
  }

  #sendCancelBestEffort(requestId, generationId) {
    if (!this.binding || this.terminal || this.state !== "ready") return;
    try {
      this.#enqueue(
        this.identityMode
          ? createIdentityCancel({
              profileId: this.binding.profileId,
              sessionId: this.binding.sessionId,
              generationId,
              requestId,
            })
          : createCancel({
              profileId: this.binding.profileId,
              sessionId: this.binding.sessionId,
              generationId,
              requestId,
            }),
      );
    } catch {
      // Timeout is already terminal; cancellation is explicitly best-effort.
    }
  }

  #onPipeEnd() {
    if (this.state === "closing" || this.state === "closed") return;
    this.#fatal("host_unavailable");
  }

  #onExit() {
    if (this.exitObserved) return;
    this.exitObserved = true;
    if (this.state === "closing") {
      this.#finishDispose();
      return;
    }
    this.#fatal("host_unavailable");
  }

  #fatal(code) {
    if (this.terminal) return;
    this.terminal = true;
    this.terminalError = hostError(code);
    this.state = "failed";
    this.#notifyState();
    this.outboundQueue = [];
    this.writing = false;
    this.#settlePending(this.terminalError);
    if (this.rebindTimer) clearTimeout(this.rebindTimer);
    this.rebindTimer = null;
    clearTimeout(this.startTimer);
    this.startTimer = null;
    if (this.rebindWait) {
      this.rebindWait.reject(this.terminalError);
      this.rebindWait = null;
    }
    if (this.startReject) {
      this.startReject(this.terminalError);
      this.startResolve = null;
      this.startReject = null;
    }
    try {
      this.child?.stdin?.destroy?.();
      this.child?.stdout?.destroy?.();
      this.child?.kill?.();
    } catch {
      // Process exit is the final cleanup boundary.
    }
    this.#clearObservers();
    if (this.disposePromise) this.#finishDispose();
  }

  #settlePending(error) {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      settleReject(pending.reject, error);
    }
  }

  #settleOlderPending(generationId, error) {
    for (const [requestId, pending] of this.pending) {
      if (pending.generationId >= generationId) continue;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      this.#retireResponseSchema(requestId, pending);
      settleReject(pending.reject, error);
    }
  }

  #responseContext(requestId) {
    const pending = this.pending.get(requestId);
    if (pending) {
      return {
        capability: pending.capability,
        method: pending.method,
      };
    }
    return this.retiredResponseSchemas.get(requestId) ?? null;
  }

  #retireResponseSchema(requestId, pending) {
    if (!this.identityMode) return;
    this.retiredResponseSchemas.set(requestId, {
      capability: pending.capability,
      method: pending.method,
      generationId: pending.generationId,
    });
    while (this.retiredResponseSchemas.size > MAX_RETIRED_RESPONSE_SCHEMAS) {
      const oldest = this.retiredResponseSchemas.keys().next().value;
      this.retiredResponseSchemas.delete(oldest);
    }
  }

  #redactedCode(error, fallback = "protocol_error") {
    return this.identityMode
      ? redactedIdentityProtocolCode(error, fallback)
      : redactedProtocolCode(error, fallback);
  }

  #notifyState() {
    const snapshot = this.getBindingState();
    for (const listener of this.stateListeners) {
      try {
        listener(snapshot);
      } catch {
        // State observers are diagnostic only and cannot break transport.
      }
    }
  }

  #finishDispose() {
    if (this.state === "closed") return;
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    this.terminal = true;
    this.outboundQueue = [];
    this.writing = false;
    this.state = "closed";
    this.#notifyState();
    this.#clearObservers();
    const resolve = this.disposeResolve;
    this.disposeResolve = null;
    resolve?.();
  }

  #clearObservers() {
    this.lifecycleListeners.clear();
    this.stateListeners.clear();
    this.lifecycleBuffer = [];
    this.retiredResponseSchemas.clear();
  }
}

export { HostProtocolError };
