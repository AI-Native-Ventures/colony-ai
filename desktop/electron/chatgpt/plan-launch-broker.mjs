import { randomBytes } from "node:crypto";
import path from "node:path";
import { prepareCodexPlanLaunch } from "./codex-plan-launch.mjs";
import { ChatGptError } from "./policy.mjs";

export const PLAN_RUNTIME_VERSIONS = Object.freeze({
  adapter: "2.1.1",
  codex: "0.159.1",
});
const MAX_RECEIPTS = 64;
const RECEIPT_DEADLINE = 30_000;
const SCOPE_KEYS = ["communityId", "agentId", "accountId", "generation"];
const FAILURE_CODES = new Set([
  "feature_disabled",
  "invalid_plan_launch",
  "invalid_plan_operation",
  "invalid_model",
  "remote_plan_disallowed",
  "plan_runtime_unavailable",
  "plan_not_ready",
  "plan_launch_cancelled",
  "plan_launch_busy",
  "duplicate_plan_generation",
  "plan_receipt_expired",
  "model_not_entitled",
  "relay_capacity",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
]);

function validate(payload, extras) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).some(
      (key) => ![...SCOPE_KEYS, ...extras].includes(key),
    ) ||
    ![payload.communityId, payload.agentId].every(
      (value) =>
        typeof value === "string" && /^[A-Za-z0-9_:.-]{1,256}$/.test(value),
    ) ||
    typeof payload.accountId !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.accountId) ||
    typeof payload.generation !== "string" ||
    !/^[a-f0-9]{32}$/.test(payload.generation)
  )
    throw new ChatGptError("invalid_plan_launch");
}

function runtimeFiles(files) {
  if (
    !files ||
    files.adapterVersion !== PLAN_RUNTIME_VERSIONS.adapter ||
    files.codexVersion !== PLAN_RUNTIME_VERSIONS.codex ||
    typeof files.adapterPath !== "string" ||
    typeof files.codexPath !== "string" ||
    !path.isAbsolute(files.adapterPath) ||
    !path.isAbsolute(files.codexPath)
  )
    throw new ChatGptError("plan_runtime_unavailable");
  return files;
}

/** Main-only receipt lifecycle. resolveRuntime must verify Colony bundle files. */
export function createPlanLaunchBroker({
  runtime,
  userData,
  appVersion,
  resolveRuntime,
  timers = { set: setTimeout, clear: clearTimeout },
}) {
  if (typeof resolveRuntime !== "function")
    throw new ChatGptError("plan_runtime_unavailable");
  const receipts = new Map();
  const agents = new Map();
  const preparingAgents = new Map();
  let closed = false;

  const key = (payload) =>
    JSON.stringify([payload.communityId, payload.agentId]);
  const current = (entry) => !closed && receipts.get(entry.id) === entry;
  const release = (entry) => {
    if (!entry || receipts.get(entry.id) !== entry) return false;
    receipts.delete(entry.id);
    if (agents.get(entry.agentKey) === entry.id) agents.delete(entry.agentKey);
    timers.clear(entry.timer);
    entry.launch?.dispose();
    return true;
  };
  const matching = (payload) => {
    const entry = receipts.get(payload.leaseId);
    if (
      !entry ||
      !SCOPE_KEYS.every((field) => entry.scope[field] === payload[field])
    )
      return null;
    return entry;
  };
  const unsubscribe = runtime.service.policy.enabled
    ? runtime.service.onRetire((accountId) => {
        for (const entry of receipts.values())
          if (accountId === null || entry.scope.accountId === accountId)
            release(entry);
      })
    : () => {};

  async function prepare(payload, signal) {
    validate(payload, ["backend", "model"]);
    if (payload.backend !== "local")
      throw new ChatGptError("remote_plan_disallowed");
    if (
      typeof payload.model !== "string" ||
      !/^[A-Za-z0-9._:-]{1,200}$/.test(payload.model)
    )
      throw new ChatGptError("invalid_model");
    if (signal?.aborted) throw new ChatGptError("plan_launch_cancelled");
    const agentKey = key(payload);
    // A cancelled/expired handler may still be persisting the stable private
    // home. Retain its scope until it exits so it cannot overwrite a successor.
    if (preparingAgents.has(agentKey))
      throw new ChatGptError("plan_launch_busy");
    const previous = receipts.get(agents.get(agentKey));
    if (previous?.scope.generation === payload.generation)
      throw new ChatGptError("duplicate_plan_generation");
    let occupied = receipts.size;
    for (const preparing of preparingAgents.values())
      if (!receipts.has(preparing.id)) occupied++;
    if (occupied >= MAX_RECEIPTS && !previous)
      throw new ChatGptError("relay_capacity");
    // A native restart stops its old child first. Retire its capability before
    // preparing the replacement; a late release cannot retire the new one.
    release(previous);
    const entry = {
      id: randomBytes(32).toString("base64url"),
      agentKey,
      scope: Object.fromEntries(
        SCOPE_KEYS.map((field) => [field, payload[field]]),
      ),
      phase: "preparing",
      launch: null,
    };
    receipts.set(entry.id, entry);
    agents.set(agentKey, entry.id);
    preparingAgents.set(agentKey, entry);
    const expire = () => release(entry);
    entry.timer = timers.set(expire, RECEIPT_DEADLINE);
    entry.timer?.unref?.();
    signal?.addEventListener("abort", expire, { once: true });
    const assertCurrent = () => {
      if (!current(entry) || signal?.aborted)
        throw new ChatGptError("plan_launch_cancelled");
    };
    try {
      const files = runtimeFiles(await resolveRuntime());
      assertCurrent();
      const status = await runtime.state.status(payload.accountId);
      assertCurrent();
      if (status.state !== "ready")
        throw new ChatGptError(
          FAILURE_CODES.has(status.code) ? status.code : "plan_not_ready",
        );
      const models = await runtime.relay.models(payload.accountId);
      assertCurrent();
      if (!models.some((model) => model.slug === payload.model))
        throw new ChatGptError("model_not_entitled");
      const launch = await prepareCodexPlanLaunch({
        service: runtime.service,
        relay: runtime.relay,
        userData,
        ...entry.scope,
        backend: payload.backend,
        model: payload.model,
        appVersion,
        codexPath: files.codexPath,
      });
      entry.launch = launch;
      // Persistence may finish after cancellation or expiry. Always revoke
      // this late capability, even if its receipt has already been removed.
      if (!current(entry) || signal?.aborted) {
        launch.dispose();
        throw new ChatGptError("plan_launch_cancelled");
      }
      entry.phase = "prepared";
      timers.clear(entry.timer);
      entry.timer = timers.set(expire, RECEIPT_DEADLINE);
      entry.timer?.unref?.();
      return {
        leaseId: entry.id,
        adapterPath: files.adapterPath,
        env: launch.env,
        clientInfo: launch.clientInfo,
      };
    } catch (error) {
      release(entry);
      throw error;
    } finally {
      signal?.removeEventListener("abort", expire);
      if (preparingAgents.get(agentKey) === entry)
        preparingAgents.delete(agentKey);
    }
  }

  const broker = {
    /** Native-internal operation. Call handlePrivateRequest for stdio dispatch. */
    async request(name, payload, signal) {
      if (closed || !runtime.service.policy.enabled)
        throw new ChatGptError("feature_disabled");
      if (name === "plan_prepare") return prepare(payload, signal);
      if (!["plan_commit", "plan_release"].includes(name))
        throw new ChatGptError("invalid_plan_operation");
      validate(payload, ["leaseId"]);
      if (
        typeof payload.leaseId !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.leaseId)
      )
        throw new ChatGptError("invalid_plan_launch");
      if (signal?.aborted) throw new ChatGptError("plan_launch_cancelled");
      const entry = matching(payload);
      if (name === "plan_release") return { released: release(entry) };
      if (!entry || entry.phase === "preparing")
        throw new ChatGptError("plan_receipt_expired");
      entry.phase = "active";
      timers.clear(entry.timer);
      return { committed: true };
    },
    /** Typed failures preserve recovery codes without exposing exception text. */
    async handlePrivateRequest(name, payload, signal) {
      try {
        return {
          ok: true,
          result: await broker.request(name, payload, signal),
        };
      } catch (error) {
        return {
          ok: false,
          code:
            error instanceof ChatGptError && FAILURE_CODES.has(error.code)
              ? error.code
              : "plan_launch_failed",
        };
      }
    },
    /** Revoke active and unacknowledged receipts before shutting down native. */
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of receipts.values()) release(entry);
    },
  };
  return broker;
}
