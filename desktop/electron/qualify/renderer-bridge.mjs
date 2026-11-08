import crypto from "node:crypto";

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(input) {
  return typeof input.error === "string" && input.error.trim()
    ? input.error.trim()
    : "The qualification renderer could not complete its request.";
}

/**
 * Correlates trusted renderer reads and writes with the Electron-main
 * qualification service. Responses from an earlier renderer generation are
 * rejected before they can affect the current business scope.
 */
export function createQualificationRendererRequestBroker({
  currentGeneration,
  isAvailable,
  requestId = () => crypto.randomUUID(),
  send,
  timeoutMs = 30_000,
  timers = { clear: clearTimeout, set: setTimeout },
} = {}) {
  if (typeof currentGeneration !== "function") {
    throw new Error("Qualification renderer generation is required.");
  }
  if (typeof isAvailable !== "function") {
    throw new Error("Qualification renderer availability is required.");
  }
  if (typeof requestId !== "function" || typeof send !== "function") {
    throw new Error("Qualification renderer transport is required.");
  }

  const pending = new Map();

  function request(operation, payload) {
    if (!isAvailable()) {
      return Promise.reject(
        new Error("The qualification window is no longer available."),
      );
    }
    const id = requestId();
    const generation = currentGeneration();
    return new Promise((resolve, reject) => {
      const timeout = timers.set(() => {
        pending.delete(id);
        reject(
          new Error("The qualification renderer did not respond in time."),
        );
      }, timeoutMs);
      pending.set(id, { generation, resolve, reject, timeout });
      send({
        type: "shell-event",
        event: "qualify:request",
        payload: { requestId: id, generation, operation, payload },
      });
    });
  }

  function respond(input) {
    if (
      !record(input) ||
      typeof input.requestId !== "string" ||
      typeof input.generation !== "number"
    ) {
      throw new Error("Invalid qualification renderer response.");
    }
    const request = pending.get(input.requestId);
    if (!request) throw new Error("Qualification renderer response is stale.");
    pending.delete(input.requestId);
    timers.clear(request.timeout);
    if (
      request.generation !== input.generation ||
      request.generation !== currentGeneration()
    ) {
      request.reject(
        new Error(
          "Desktop renderer changed; reopen this qualification action.",
        ),
      );
      return { accepted: false };
    }
    if (input.ok === true) {
      request.resolve(input.result);
      return { accepted: true };
    }
    request.reject(new Error(responseError(input)));
    return { accepted: true };
  }

  function rejectAll(message) {
    for (const request of pending.values()) {
      timers.clear(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
  }

  return { rejectAll, request, respond };
}
