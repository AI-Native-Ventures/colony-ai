import path from "node:path";

import {
  createJsonRunStore,
  createQualifyRunController,
} from "./run-controller.mjs";

export const QUALIFY_MAIN_COMMANDS = new Set([
  "qualify_start",
  "qualify_resume",
  "qualify_cancel",
  "qualify_snapshot",
  "qualify_renderer_response",
]);

const RUN_STORE_FILE = "qualification-runs.json";

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`A qualification ${label} is required.`);
  return value.trim();
}

function scopeFrom(input) {
  if (!record(input)) throw new Error("Invalid qualification request.");
  return {
    channelId: requiredString(input.channelId, "channel"),
    communityId: requiredString(input.communityId, "community"),
  };
}

function scopeKey(scope) {
  return `${scope.communityId}\u0000${scope.channelId}`;
}

function startInputFrom(input) {
  if (!record(input)) throw new Error("Invalid qualification request.");
  return {
    leads: input.leads,
    refresh: input.refresh === true,
    runId: input.runId,
    selectedSignals: input.selectedSignals,
  };
}

function runIdFrom(input) {
  if (!record(input)) throw new Error("Invalid qualification request.");
  return requiredString(input.runId, "run id");
}

/** The app-owned run journal path. It is never selected by the renderer. */
export function qualifyRunStorePath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new Error("Qualification storage needs an absolute app data path.");
  }
  return path.join(path.resolve(userDataPath), RUN_STORE_FILE);
}

/**
 * Electron-main qualification boundary. The renderer gets progress snapshots
 * only. Current heads and signed business-record actions cross back through a
 * correlated, generation-fenced request supplied by app-window.
 */
export function createQualifyService({
  userDataPath,
  requestRenderer,
  emit = () => {},
  filesystem,
  fetchPage,
  extract,
  followupLinks,
  robots,
  isNonSiteUrl,
  clock,
  makeRunId,
  businessTimeoutMs,
} = {}) {
  if (typeof requestRenderer !== "function") {
    throw new Error("Qualification service needs a trusted renderer bridge.");
  }
  const store = createJsonRunStore({
    filePath: qualifyRunStorePath(userDataPath),
    ...(filesystem ? { filesystem } : {}),
  });
  const controllers = new Map();
  const active = new Map();
  const firstProgress = new Map();
  let disposed = false;

  function report(scope, progress) {
    const waiter = firstProgress.get(progress.runId);
    if (waiter) {
      firstProgress.delete(progress.runId);
      waiter.resolve(progress);
    }
    emit("qualify:progress", { ...scope, progress });
  }

  function controllerFor(scope) {
    const key = scopeKey(scope);
    const existing = controllers.get(key);
    if (existing) return existing;
    const controller = createQualifyRunController({
      store,
      loadHead: (leadId) =>
        requestRenderer("load_head", {
          ...scope,
          leadId,
        }),
      publish: (action) =>
        requestRenderer("publish", {
          ...scope,
          action,
        }),
      ...(fetchPage ? { fetchPage } : {}),
      ...(extract ? { extract } : {}),
      ...(followupLinks ? { followupLinks } : {}),
      ...(robots ? { robots } : {}),
      ...(isNonSiteUrl ? { isNonSiteUrl } : {}),
      ...(clock ? { clock } : {}),
      ...(makeRunId ? { makeRunId } : {}),
      ...(businessTimeoutMs ? { businessTimeoutMs } : {}),
      onProgress: (progress) => report(scope, progress),
    });
    controllers.set(key, controller);
    return controller;
  }

  function waitForInitialProgress(runId) {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    firstProgress.set(runId, { resolve, reject });
    return promise;
  }

  function track(runId, controller, scope, work) {
    active.set(runId, { controller, scope, runId, work });
    void work.finally(() => active.delete(runId)).catch(() => {});
  }

  async function start(input) {
    if (disposed) throw new Error("Qualification service is unavailable.");
    const scope = scopeFrom(input);
    const runInput = startInputFrom(input);
    const runId = requiredString(runInput.runId, "run id");
    const controller = controllerFor(scope);
    const initial = waitForInitialProgress(runId);
    const work = controller.start(runInput);
    track(runId, controller, scope, work);
    try {
      return await Promise.race([
        initial,
        work.then(() => controller.snapshot(runId)),
      ]);
    } catch (error) {
      const waiter = firstProgress.get(runId);
      if (waiter) {
        firstProgress.delete(runId);
        waiter.reject(error);
      }
      throw error;
    }
  }

  async function resume(input) {
    if (disposed) throw new Error("Qualification service is unavailable.");
    const scope = scopeFrom(input);
    const runId = runIdFrom(input);
    const controller = controllerFor(scope);
    const initial = waitForInitialProgress(runId);
    const work = controller.resume(runId);
    track(runId, controller, scope, work);
    try {
      return await Promise.race([
        initial,
        work.then(() => controller.snapshot(runId)),
      ]);
    } catch (error) {
      const waiter = firstProgress.get(runId);
      if (waiter) {
        firstProgress.delete(runId);
        waiter.reject(error);
      }
      throw error;
    }
  }

  async function snapshot(input) {
    const scope = scopeFrom(input);
    const runId = runIdFrom(input);
    const progress = await controllerFor(scope).snapshot(runId);
    // A main-process restart retires every active worker. The journal remains
    // durable, but presenting that orphaned running state as active would hide
    // the only recovery affordance from the user.
    if (progress?.status === "running" && !active.has(runId)) {
      return { ...progress, status: "paused" };
    }
    return progress;
  }

  async function cancel(input) {
    const scope = scopeFrom(input);
    const runId = runIdFrom(input);
    const activeRun = active.get(runId);
    return {
      cancelled:
        activeRun && scopeKey(activeRun.scope) === scopeKey(scope)
          ? activeRun.controller.cancel(runId)
          : false,
    };
  }

  return {
    start,
    resume,
    snapshot,
    cancel,
    dispose() {
      disposed = true;
      for (const { controller, runId } of active.values()) {
        controller.cancel(runId);
      }
      for (const waiter of firstProgress.values()) {
        waiter.reject(new Error("Qualification service is unavailable."));
      }
      firstProgress.clear();
    },
  };
}
