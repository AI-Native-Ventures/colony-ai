import { HostProtocolError, redactedProtocolCode } from "./host-protocol.mjs";

export class RendererHostError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "RendererHostError";
    this.code = code;
  }
}

function rendererError(code) {
  return new RendererHostError(code);
}

function freezeBinding(binding) {
  return binding ? Object.freeze({ ...binding }) : null;
}

/**
 * Adapts the trusted Electron-main transport to a renderer generation.
 * Transport generations are deliberately separate from RelayClient epochs:
 * this class only fences the private host binding and never owns a relay
 * subscription/reconnect state machine.
 */
export class RendererHost {
  constructor({ transport, maxListeners = null } = {}) {
    if (!transport || typeof transport.start !== "function") {
      throw new TypeError("transport is required");
    }
    this.transport = transport;
    this.maxListeners =
      maxListeners ?? transport.protocol?.subscriptionLimit ?? 1024;
    this.maxRebindQueue = transport.protocol?.outboundQueueLimit ?? 64;
    this.state = "idle";
    this.binding = null;
    this.targetGeneration = null;
    this.rebindRunning = false;
    this.rebindWaiters = [];
    this.lifecycleListeners = new Set();
    this.deferredLifecycle = [];
    this.rendererEpoch = 0;
    this.lastTransportGeneration = 0;
    this.startPromise = null;
    this.disposePromise = null;
    this.detachTransportEvents = null;
    this.detachTransportState = null;
    if (typeof transport.onState === "function") {
      this.detachTransportState = transport.onState((snapshot) => {
        this.#handleTransportState(snapshot);
      });
    }
    if (typeof transport.onLifecycle === "function") {
      this.detachTransportEvents = transport.onLifecycle((frame) => {
        this.#handleLifecycle(frame);
      });
    }
  }

  async start() {
    if (this.state === "bound") return this.bindingState();
    if (this.startPromise) return this.startPromise;
    if (this.state === "closed" || this.state === "unavailable") {
      throw rendererError("host_unavailable");
    }
    this.state = "starting";
    const startEpoch = this.rendererEpoch;
    this.startPromise = (async () => {
      try {
        const binding = await this.transport.start();
        if (this.state === "closed" || this.rendererEpoch !== startEpoch) {
          throw rendererError("host_disposed");
        }
        this.binding = freezeBinding({
          ...binding,
          registryDigest:
            binding.registryDigest ??
            this.transport.getBindingState?.().registryDigest ??
            null,
        });
        this.targetGeneration = this.binding.generationId;
        this.lastTransportGeneration = this.binding.generationId;
        this.state = "bound";
        this.#flushLifecycle();
        return this.bindingState();
      } catch (error) {
        const rendererErrorValue = this.#asRendererError(error);
        if (this.state !== "closed") {
          this.binding = null;
          this.targetGeneration = null;
          this.state = "unavailable";
          this.#rejectRebindWaiters(rendererErrorValue);
        }
        throw rendererErrorValue;
      }
    })();
    return this.startPromise;
  }

  async request({
    capability = "health-safe",
    method = "get_default_relay_url",
    payload = {},
  } = {}) {
    if (this.state !== "bound" || !this.binding) {
      throw rendererError(
        this.state === "rebinding" ? "renderer_rebinding" : "host_unavailable",
      );
    }
    const generation = this.binding.generationId;
    const epoch = this.rendererEpoch;
    let response;
    try {
      response = await this.transport.request({
        capability,
        method,
        payload,
        generationId: generation,
      });
    } catch (error) {
      throw this.#asRendererError(error);
    }
    if (
      this.state !== "bound" ||
      this.rendererEpoch !== epoch ||
      !this.binding ||
      this.binding.generationId !== generation ||
      response?.generationId !== generation
    ) {
      throw rendererError("renderer_rebound");
    }
    return response;
  }

  /**
   * Fence the current renderer synchronously and return a barrier that only
   * resolves after the requested REBOUND acknowledgement. A second reset
   * while the first rebind is in flight queues one monotonic next generation;
   * no request is admitted until the final queued generation is bound.
   */
  reset() {
    if (
      !this.binding ||
      this.state === "closed" ||
      this.state === "unavailable"
    ) {
      return Promise.reject(rendererError("host_unavailable"));
    }
    if (this.rebindWaiters.length >= this.maxRebindQueue) {
      return Promise.reject(rendererError("host_busy"));
    }
    const current = this.targetGeneration ?? this.binding.generationId;
    const generation = current + 1;
    if (!Number.isSafeInteger(generation)) {
      return Promise.reject(rendererError("invalid_generation_id"));
    }
    this.rendererEpoch += 1;
    this.targetGeneration = generation;
    this.state = "rebinding";
    const barrier = new Promise((resolve, reject) => {
      this.rebindWaiters.push({ generation, resolve, reject });
    });
    void this.#drainRebinds();
    return barrier;
  }

  onLifecycle(listener) {
    if (typeof listener !== "function")
      throw new TypeError("listener must be a function");
    if (this.lifecycleListeners.size >= this.maxListeners) {
      throw rendererError("host_busy");
    }
    this.lifecycleListeners.add(listener);
    this.#flushLifecycleTo(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  bindingState() {
    return Object.freeze({
      state: this.state,
      profileId: this.binding?.profileId ?? null,
      sessionId: this.binding?.sessionId ?? null,
      generationId: this.binding?.generationId ?? null,
      transportGenerationId: this.binding?.generationId ?? null,
      relayClientEpoch: this.rendererEpoch,
      registryDigest: this.binding?.registryDigest ?? null,
    });
  }

  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.state = "closed";
    this.rendererEpoch += 1;
    this.#rejectRebindWaiters(rendererError("host_disposed"));
    this.deferredLifecycle = [];
    this.lifecycleListeners.clear();
    if (this.detachTransportEvents) {
      this.detachTransportEvents();
      this.detachTransportEvents = null;
    }
    if (this.detachTransportState) {
      this.detachTransportState();
      this.detachTransportState = null;
    }
    this.binding = null;
    this.targetGeneration = null;
    this.disposePromise = Promise.resolve(this.transport.dispose?.()).then(
      () => undefined,
    );
    return this.disposePromise;
  }

  async #drainRebinds() {
    if (this.rebindRunning || this.state === "closed") return;
    this.rebindRunning = true;
    try {
      while (
        this.binding &&
        this.binding.generationId < this.targetGeneration
      ) {
        const nextGeneration = this.binding.generationId + 1;
        const binding = await this.transport.rebind(nextGeneration);
        if (this.state === "closed" || this.state !== "rebinding") {
          return;
        }
        if (!binding || binding.generationId !== nextGeneration) {
          throw rendererError("invalid_rebound");
        }
        this.binding = freezeBinding({
          ...binding,
          registryDigest:
            binding.registryDigest ??
            this.transport.getBindingState?.().registryDigest ??
            null,
        });
        this.lastTransportGeneration = nextGeneration;
        this.#resolveRebindWaiters(nextGeneration);
      }
      if (this.state !== "closed") {
        this.state = "bound";
        this.#flushLifecycle();
      }
    } catch (error) {
      if (this.state === "closed" || this.state !== "rebinding") return;
      const rendererErrorValue = this.#asRendererError(error);
      if (this.state === "unavailable") return;
      this.binding = null;
      this.targetGeneration = null;
      this.state = "unavailable";
      this.#rejectRebindWaiters(rendererErrorValue);
      this.deferredLifecycle = [];
    } finally {
      this.rebindRunning = false;
    }
  }

  #resolveRebindWaiters(generation) {
    const remaining = [];
    for (const waiter of this.rebindWaiters) {
      if (waiter.generation <= generation) {
        waiter.resolve(this.bindingState());
      } else {
        remaining.push(waiter);
      }
    }
    this.rebindWaiters = remaining;
  }

  #rejectRebindWaiters(error) {
    const waiters = this.rebindWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  #handleLifecycle(frame) {
    const generation = frame?.generationId;
    if (!Number.isSafeInteger(generation)) return;
    if (this.state === "starting") {
      if (generation === 1 && this.deferredLifecycle.length < 2) {
        this.deferredLifecycle.push(frame);
      }
      return;
    }
    if (this.state === "rebinding") {
      if (generation === this.targetGeneration) {
        this.deferredLifecycle = [frame];
      }
      return;
    }
    if (this.state !== "bound" || generation !== this.binding?.generationId)
      return;
    this.#emitLifecycle(frame);
  }

  #handleTransportState(snapshot) {
    if (!snapshot || typeof snapshot.state !== "string") return;
    const generation = snapshot.generationId;
    if (
      Number.isSafeInteger(generation) &&
      generation < this.lastTransportGeneration
    ) {
      return;
    }
    if (Number.isSafeInteger(generation)) {
      this.lastTransportGeneration = generation;
    }
    if (!new Set(["failed", "closing", "closed"]).has(snapshot.state)) {
      return;
    }
    if (this.state === "closed") return;
    this.rendererEpoch += 1;
    this.binding = null;
    this.targetGeneration = null;
    this.state = "unavailable";
    this.deferredLifecycle = [];
    this.#rejectRebindWaiters(rendererError("host_unavailable"));
  }

  #flushLifecycle() {
    const current = this.binding?.generationId;
    const frames = this.deferredLifecycle.splice(0);
    for (const frame of frames) {
      if (frame.generationId === current) this.#emitLifecycle(frame);
    }
  }

  #flushLifecycleTo(listener) {
    const current = this.binding?.generationId;
    if (this.state !== "bound" || !current) return;
    const retained = [];
    for (const frame of this.deferredLifecycle) {
      if (frame.generationId === current) {
        this.#deliver(listener, frame);
      } else {
        retained.push(frame);
      }
    }
    this.deferredLifecycle = retained;
  }

  #emitLifecycle(frame) {
    if (this.lifecycleListeners.size === 0) {
      if (this.deferredLifecycle.length < 2) this.deferredLifecycle.push(frame);
      return;
    }
    for (const listener of this.lifecycleListeners) {
      this.#deliver(listener, frame);
    }
  }

  #deliver(listener, frame) {
    try {
      listener(
        Object.freeze({
          ...frame,
          payload: Object.freeze({ ...frame.payload }),
        }),
      );
    } catch {
      // Listener failures are isolated from the transport state machine.
    }
  }

  #asRendererError(error) {
    if (error instanceof RendererHostError) return error;
    if (error instanceof HostProtocolError) {
      return rendererError(redactedProtocolCode(error, "host_unavailable"));
    }
    return rendererError(redactedProtocolCode(error, "host_unavailable"));
  }
}
