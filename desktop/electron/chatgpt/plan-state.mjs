import { BACKOFF_MS, ChatGptError } from "./policy.mjs";
import { PLAN_LIMIT_MESSAGE } from "./inference-policy.mjs";

const LIMIT = "subscription_sharing_usage_limit_exceeded";
const UNAVAILABLE = "subscription_sharing_usage_unavailable";
const VALID = new Set(["ready", "limit", "unavailable"]);

/** Credential-free account circuits, persisted before reporting a terminal error. */
export function createPlanState({ store, now = Date.now }) {
  function read() {
    const state = store.runtimeSnapshot() ?? { version: 1, accounts: {} };
    if (
      state.version !== 1 ||
      !state.accounts ||
      Array.isArray(state.accounts) ||
      typeof state.accounts !== "object" ||
      Object.keys(state.accounts).length > 256
    )
      throw new ChatGptError("invalid_plan_state");
    for (const [id, a] of Object.entries(state.accounts))
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        !VALID.has(a.state) ||
        !Number.isSafeInteger(a.failures) ||
        a.failures < 0 ||
        a.failures > BACKOFF_MS.length ||
        !Number.isFinite(a.retryAt) ||
        a.retryAt < 0 ||
        !Array.isArray(a.models) ||
        a.models.length > 256 ||
        ![null, LIMIT, UNAVAILABLE].includes(a.code) ||
        a.models.some(
          (m) =>
            typeof m?.slug !== "string" ||
            !/^[A-Za-z0-9._:-]{1,200}$/.test(m.slug) ||
            typeof m.displayName !== "string" ||
            m.displayName.length > 200,
        )
      )
        throw new ChatGptError("invalid_plan_state");
    // The credential registry is the durable source for retirement. If cleanup
    // was interrupted, retry it before returning any derived model metadata.
    const active = new Set(
      store
        .snapshot()
        .accounts.filter((a) => a.state === "active")
        .map((a) => a.id),
    );
    let changed = false;
    for (const id of Object.keys(state.accounts))
      if (!active.has(id)) {
        delete state.accounts[id];
        changed = true;
      }
    if (changed) store.saveRuntime(state);
    return state;
  }
  function account(state, id) {
    const credential = store.snapshot().accounts.find((a) => a.id === id);
    if (!/^[a-f0-9]{64}$/.test(id) || !credential)
      throw new ChatGptError("unknown_account");
    if (credential.state !== "active") throw new ChatGptError("plan_not_ready");
    if (!state.accounts[id]) {
      if (Object.keys(state.accounts).length >= 256)
        throw new ChatGptError("plan_state_capacity");
      state.accounts[id] = {
        state: "ready",
        code: null,
        failures: 0,
        retryAt: 0,
        models: [],
      };
    }
    return state.accounts[id];
  }
  return {
    async assertReady(id) {
      return store.locked(() => {
        const a = account(read(), id);
        if (a.state === "limit") throw new ChatGptError(LIMIT, 429);
        if (
          a.state === "unavailable" &&
          (a.failures >= BACKOFF_MS.length || a.retryAt > now())
        )
          throw new ChatGptError(UNAVAILABLE, 503);
        return a.failures;
      });
    },
    async fail(id, code) {
      await store.locked(() => {
        const state = read(),
          a = account(state, id);
        // A later in-flight result must not overwrite a limit with availability.
        if (a.state !== "limit") {
          a.state = code === LIMIT ? "limit" : "unavailable";
          a.code = code === LIMIT ? LIMIT : UNAVAILABLE;
          a.failures = Math.min(a.failures + 1, BACKOFF_MS.length);
          a.retryAt =
            a.state === "limit" ? 0 : now() + BACKOFF_MS[a.failures - 1];
        }
        store.saveRuntime(state);
      });
    },
    async checkAgain(id) {
      await store.locked(() => {
        const state = read(),
          a = account(state, id);
        Object.assign(a, {
          state: "ready",
          code: null,
          failures: 0,
          retryAt: 0,
        });
        store.saveRuntime(state);
      });
    },
    async succeed(id, failures) {
      await store.locked(() => {
        const state = read(),
          a = account(state, id);
        if (a.state !== "unavailable" || a.failures !== failures) return;
        Object.assign(a, {
          state: "ready",
          code: null,
          failures: 0,
          retryAt: 0,
        });
        store.saveRuntime(state);
      });
    },
    async saveModels(id, models) {
      await store.locked(() => {
        const state = read(),
          a = account(state, id);
        a.models = models;
        store.saveRuntime(state);
      });
    },
    async status(id) {
      return store.locked(() => {
        const state = read();
        const credential = store.snapshot().accounts.find((a) => a.id === id);
        if (!credential) throw new ChatGptError("unknown_account");
        if (credential.state !== "active")
          return {
            state: credential.state,
            code: credential.last_error ?? null,
            failures: 0,
            retryAt: 0,
            models: [],
            message: null,
          };
        const a = account(state, id);
        store.saveRuntime(state);
        return {
          state: a.state,
          code: a.code,
          failures: a.failures,
          retryAt: a.retryAt,
          models: a.models.map((m) => ({
            slug: m.slug,
            displayName: m.displayName,
          })),
          message: a.state === "limit" ? PLAN_LIMIT_MESSAGE : null,
        };
      });
    },
  };
}
