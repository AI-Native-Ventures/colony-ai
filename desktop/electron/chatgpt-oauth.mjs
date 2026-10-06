import { createChatGptStore, accountId } from "./chatgpt/store.mjs";
import { startChatGptCallback } from "./chatgpt/callback.mjs";
import { createChatGptHttp } from "./chatgpt/http.mjs";
import { createIdTokenValidator } from "./chatgpt/id-token.mjs";
import {
  BACKOFF_MS,
  ChatGptError,
  ISSUER,
  PLAN_SCOPE,
  REFRESH_LIFETIME_MS,
  TERMINAL_REFRESH_ERRORS,
  chatGptPolicy,
} from "./chatgpt/policy.mjs";

function tokenFields(data, now) {
  const text = (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 65536;
  if (
    !text(data?.access_token) ||
    !text(data.refresh_token) ||
    !text(data.id_token) ||
    data.token_type?.toLowerCase() !== "bearer" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    data.expires_in > 86400 ||
    typeof data.scope !== "string" ||
    data.scope.length > 4096
  )
    throw new ChatGptError("invalid_token_response");
  let earliest = now;
  if (data.earliest_refresh_at !== undefined) {
    // OAuth timestamps use Unix seconds, as documented for token claims.
    if (
      !Number.isFinite(data.earliest_refresh_at) ||
      data.earliest_refresh_at < 0
    )
      throw new ChatGptError("invalid_token_response");
    earliest = data.earliest_refresh_at * 1000;
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    token_type: "Bearer",
    expires_in: data.expires_in,
    expires_at: now + data.expires_in * 1000,
    earliest_refresh_at: earliest,
    refresh_expires_at: now + REFRESH_LIFETIME_MS,
    scopes: data.scope.split(/\s+/).filter(Boolean),
    saved_at: now,
  };
}

function clearTokens(account, retainHint = false) {
  delete account.access_token;
  delete account.refresh_token;
  if (!retainHint) delete account.id_token;
  delete account.expires_at;
  delete account.refresh_expires_at;
  delete account.earliest_refresh_at;
  delete account.refresh_inflight;
  delete account.rotation_id_token;
  delete account.next_attempt_at;
  account.scopes = [];
}

function find(state, id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) throw new ChatGptError("unknown_account");
  return account;
}

/** Project a strict allowlist; credential material cannot cross renderer IPC. */
export function publicChatGptState(state, connecting = false) {
  return {
    enabled: true,
    connecting,
    activeAccountId: state.active,
    accounts: state.accounts.map((a, index) => ({
      id: a.id,
      label: `ChatGPT account ${index + 1}`,
      email: a.email ?? null,
      plan: "ChatGPT plan",
      state: a.state,
      lastError: a.last_error ?? null,
      remoteRevocationPending: Boolean(a.pending_revoke),
    })),
    pendingRegistrations: state.pending.map((p) => ({
      id: p.id,
      state: "needs_sign_in",
      remoteRevocationPending: Boolean(p.pending_revoke),
    })),
  };
}

/** Install-scoped OAuth owner. Agents and renderers never refresh credentials. */
export function createChatGptService({
  userData,
  openExternal,
  bringToFront = () => {},
  env = process.env,
  build,
  now = Date.now,
  random = Math.random,
  fetchImpl,
  timeoutMs,
  listenerTimeoutMs,
  callbackPort,
  timers = { set: setTimeout, clear: clearTimeout },
  store = createChatGptStore(userData),
} = {}) {
  const policy = chatGptPolicy(env, build);
  const request = createChatGptHttp({ fetchImpl, timeoutMs });
  const validator = createIdTokenValidator({ policy, request, now });
  const flights = new Map();
  const epochs = new Map();
  let attempt = null;
  let initialized = false;
  let stopped = false;
  let timer;
  let backgroundError = null;
  const epoch = (id) => epochs.get(id) ?? 0;
  const bump = (id) => epochs.set(id, epoch(id) + 1);
  const enabled = () => {
    if (!policy.enabled) throw new ChatGptError("feature_disabled");
    if (stopped) throw new ChatGptError("service_stopped");
  };
  async function initialize() {
    enabled();
    if (initialized) return;
    await store.locked(() => {
      store.hostId();
      const state = store.snapshot();
      let changed = false;
      for (const a of state.accounts) {
        if (a.refresh_inflight) {
          if (a.refresh_token)
            a.pending_revoke = {
              token: a.refresh_token,
              expires_at: a.refresh_expires_at,
              retry_count: 0,
            };
          clearTokens(a, true);
          a.state = "needs_sign_in";
          a.last_error = "refresh_interrupted";
          a.generation++;
          changed = true;
        }
      }
      if (changed) store.save(state);
    });
    initialized = true;
  }
  async function status() {
    if (!policy.enabled)
      return {
        enabled: false,
        connecting: false,
        activeAccountId: null,
        accounts: [],
      };
    await initialize();
    const state = await store.locked(() => store.snapshot());
    return {
      ...publicChatGptState(state, Boolean(attempt)),
      serviceError: backgroundError,
    };
  }
  function cancel() {
    if (!attempt) return false;
    attempt.controller.abort();
    attempt = null;
    return true;
  }
  async function connect({
    accountId: selected,
    registrationId,
    consent = false,
  } = {}) {
    await initialize();
    if (attempt) throw new ChatGptError("sign_in_busy");
    const current = { controller: new AbortController() };
    attempt = current;
    let listener;
    let pendingId;
    const check = () => {
      if (attempt !== current || current.controller.signal.aborted || stopped)
        throw new ChatGptError("cancelled");
    };
    try {
      const prepared = await store.locked(() => {
        const state = store.snapshot();
        const pending = registrationId
          ? state.pending.find((p) => p.id === registrationId)
          : null;
        if (registrationId && !pending)
          throw new ChatGptError("unknown_account");
        const account = selected ? find(state, selected) : pending;
        if (!account && state.accounts.length >= 16)
          throw new ChatGptError("account_limit");
        if (account?.pending_revoke)
          throw new ChatGptError("revocation_pending");
        return { account, hostId: store.hostId() };
      });
      check();
      const generation = prepared.account?.generation;
      const fence = selected ? epoch(selected) : 0;
      listener = await startChatGptCallback({
        policy,
        ...prepared,
        consent,
        signal: current.controller.signal,
        timeoutMs: listenerTimeoutMs,
        port: callbackPort,
      });
      check();
      await openExternal(listener.url);
      const callback = await listener.result;
      check();
      if (!callback) return { outcome: "cancelled", ...(await status()) };
      pendingId = accountId(callback.clientId, "pending");
      await store.locked(() => {
        check();
        const state = store.snapshot();
        if (!state.pending.some((p) => p.id === pendingId)) {
          if (state.pending.length >= 16)
            throw new ChatGptError("account_limit");
          state.pending.push({
            id: pendingId,
            client_id: callback.clientId,
            state: "needs_sign_in",
          });
          store.save(state);
        }
      });
      const data = await request(`${policy.auth}/api/accounts/oauth/token`, {
        signal: current.controller.signal,
        form: {
          grant_type: "authorization_code",
          client_id: callback.clientId,
          code: callback.code,
          code_verifier: callback.verifier,
          redirect_uri: callback.redirectUri,
          resource: policy.resource,
        },
      });
      const tokens = tokenFields(data, now());
      await store.locked(() => {
        const state = store.snapshot();
        const pending = state.pending.find((p) => p.id === pendingId);
        if (!pending) throw new ChatGptError("stale_result");
        pending.pending_revoke = {
          token: tokens.refresh_token,
          expires_at: tokens.refresh_expires_at,
          retry_count: 0,
          next_attempt_at: 0,
        };
        store.save(state);
      });
      check();
      const identity = await validator.validate(tokens.id_token, {
        clientId: callback.clientId,
        nonce: callback.nonce,
        subject: prepared.account?.subject,
      });
      check();
      await store.locked(() => {
        check();
        const state = store.snapshot();
        const id = accountId(callback.clientId, identity.subject);
        const previous = state.accounts.find((a) => a.id === id);
        if (
          (selected &&
            (previous?.generation !== generation ||
              epoch(selected) !== fence)) ||
          (!selected && previous)
        )
          throw new ChatGptError("stale_result");
        const account = {
          id,
          client_id: callback.clientId,
          issuer: ISSUER,
          subject: identity.subject,
          email: identity.email,
          ext_agent_host_id: prepared.hostId,
          generation: (previous?.generation ?? 0) + 1,
          ...tokens,
          state: tokens.scopes.includes(PLAN_SCOPE) ? "active" : "plan_use_off",
          retry_count: 0,
          last_error: null,
        };
        if (previous) Object.assign(previous, account);
        else state.accounts.push(account);
        state.active = id;
        state.pending = state.pending.filter((p) => p.id !== pendingId);
        store.save(state);
      });
      bringToFront();
      await schedule();
      return { outcome: "connected", ...(await status()), connecting: false };
    } catch (error) {
      if (pendingId) await revoke(pendingId);
      if (error.code === "cancelled")
        return { outcome: "cancelled", ...(await status()), connecting: false };
      throw error instanceof ChatGptError
        ? error
        : new ChatGptError("sign_in_failed");
    } finally {
      listener?.close();
      if (attempt === current) attempt = null;
    }
  }
  async function select(id) {
    await initialize();
    cancel();
    await store.locked(() => {
      const state = store.snapshot();
      if (state.active) find(state, state.active).generation++;
      find(state, id).generation++;
      state.active = id;
      store.save(state);
    });
    return status();
  }
  function refresh(id, rejectedToken) {
    enabled();
    if (flights.has(id)) return flights.get(id);
    const fence = epoch(id);
    const flight = (async () => {
      await initialize();
      await store.locked(async () => {
        const state = store.snapshot();
        const a = find(state, id);
        if (a.state !== "active" && a.state !== "plan_use_off") return;
        if (rejectedToken && a.access_token !== rejectedToken) return;
        if (a.next_attempt_at > now() || a.earliest_refresh_at > now()) return;
        if (a.refresh_expires_at <= now() || !a.refresh_token) {
          clearTokens(a, true);
          a.state = "needs_sign_in";
          a.last_error = "refresh_token_expired";
          a.generation++;
          store.save(state);
          return;
        }
        a.refresh_inflight = true;
        store.save(state);
        try {
          const data = await request(
            `${policy.auth}/api/accounts/oauth/token`,
            {
              form: {
                grant_type: "refresh_token",
                client_id: a.client_id,
                refresh_token: a.refresh_token,
                resource: policy.resource,
              },
            },
          );
          const tokens = tokenFields(data, now());
          // Save rotated material before any subsequent network validation.
          // A crash here remains fenced by the durable refresh_inflight marker.
          Object.assign(a, tokens, {
            id_token: a.id_token,
            rotation_id_token: tokens.id_token,
          });
          store.save(state);
          if (stopped || epoch(id) !== fence) {
            // A retired result must not reactivate the selected account. On a
            // local disconnect the latest rotated session still needs revoke.
            a.pending_revoke = {
              token: tokens.refresh_token,
              expires_at: tokens.refresh_expires_at,
              retry_count: 0,
            };
            clearTokens(a);
            a.state = "pending_revoke";
            a.generation++;
            store.save(state);
            return;
          }
          const identity = await validator.validate(tokens.id_token, {
            clientId: a.client_id,
            subject: a.subject,
          });
          if (stopped || epoch(id) !== fence)
            throw new ChatGptError("stale_result");
          a.email = identity.email;
          a.id_token = tokens.id_token;
          delete a.rotation_id_token;
          a.state = tokens.scopes.includes(PLAN_SCOPE)
            ? "active"
            : "plan_use_off";
          a.retry_count = 0;
          a.next_attempt_at = 0;
          a.last_error = null;
          delete a.refresh_inflight;
          a.generation++;
          store.save(state);
        } catch (error) {
          const code =
            error instanceof ChatGptError ? error.code : "refresh_failed";
          // Leave the last successfully saved rotation journal intact. Never
          // overwrite it with a retry record after a failed atomic persist.
          if (code.startsWith("storage_")) throw error;
          a.last_error = code;
          if (
            code.startsWith("invalid_") ||
            code === "identity_mismatch" ||
            code === "unsupported_algorithm" ||
            code === "stale_result"
          ) {
            if (a.refresh_token)
              a.pending_revoke = {
                token: a.refresh_token,
                expires_at: a.refresh_expires_at,
                retry_count: 0,
              };
          }
          if (
            TERMINAL_REFRESH_ERRORS.has(code) ||
            code === "invalid_client" ||
            (error.status > 0 && error.status < 500) ||
            (![
              "network_error",
              "request_timeout",
              "http_error",
              "invalid_response",
            ].includes(code) &&
              error.status < 500)
          ) {
            clearTokens(a, true);
            a.state = "needs_sign_in";
          } else {
            delete a.refresh_inflight;
            a.retry_count = (a.retry_count ?? 0) + 1;
            if (a.retry_count > BACKOFF_MS.length) {
              clearTokens(a, true);
              a.state = "needs_sign_in";
            } else
              a.next_attempt_at =
                now() +
                BACKOFF_MS[a.retry_count - 1] +
                Math.floor(random() * 1000);
          }
          a.generation++;
          store.save(state);
          // Persistence failures must propagate; callers cannot report success.
        }
      });
      return status();
    })();
    flights.set(id, flight);
    void flight
      .finally(() => {
        if (flights.get(id) === flight) flights.delete(id);
      })
      .catch(() => {});
    return flight;
  }
  async function revoke(id) {
    await store.locked(async () => {
      const state = store.snapshot();
      const a =
        state.accounts.find((account) => account.id === id) ??
        state.pending.find((pending) => pending.id === id);
      if (!a) return;
      const pending = a.pending_revoke;
      if (
        !pending ||
        pending.next_attempt_at > now() ||
        pending.retry_count >= BACKOFF_MS.length
      )
        return;
      try {
        const discovery = await validator.discovery();
        await request(discovery.revocation_endpoint, {
          empty: true,
          form: {
            token: pending.token,
            token_type_hint: "refresh_token",
            client_id: a.client_id,
          },
        });
        delete a.pending_revoke;
        a.state =
          state.pending.includes(a) || a.state === "needs_sign_in"
            ? "needs_sign_in"
            : "disconnected";
        a.last_error = null;
      } catch (error) {
        pending.retry_count++;
        pending.next_attempt_at =
          now() +
          BACKOFF_MS[Math.min(pending.retry_count - 1, BACKOFF_MS.length - 1)] +
          Math.floor(random() * 1000);
        a.last_error =
          error instanceof ChatGptError ? error.code : "revocation_failed";
      }
      if (a.generation !== undefined) a.generation++;
      store.save(state);
    });
  }
  async function disconnect(id) {
    await initialize();
    bump(id);
    cancel();
    await store.locked(() => {
      const state = store.snapshot();
      const a = find(state, id);
      if (a.refresh_token)
        a.pending_revoke = {
          token: a.refresh_token,
          expires_at: a.refresh_expires_at,
          retry_count: 0,
        };
      else if (a.pending_revoke) {
        a.pending_revoke.retry_count = 0;
        a.pending_revoke.next_attempt_at = 0;
      }
      clearTokens(a);
      a.generation++;
      a.state = a.pending_revoke ? "pending_revoke" : "disconnected";
      if (state.active === id) state.active = null;
      store.save(state);
    });
    await revoke(id);
    await schedule();
    return status();
  }
  async function tick() {
    await initialize();
    const state = await store.locked(() => store.snapshot());
    for (const pending of state.pending)
      if (!stopped && pending.pending_revoke) await revoke(pending.id);
    for (const a of state.accounts) {
      if (stopped) return;
      if (a.pending_revoke) await revoke(a.id);
      else if (
        (a.state === "active" || a.state === "plan_use_off") &&
        now() >=
          Math.max(
            a.earliest_refresh_at ?? 0,
            a.next_attempt_at ?? 0,
            a.expires_at - 300_000,
          )
      )
        await refresh(a.id);
    }
    await schedule();
  }
  async function schedule() {
    timers.clear(timer);
    if (stopped || !policy.enabled) return;
    const state = await store.locked(() => store.snapshot());
    const deadlines = [...state.accounts, ...state.pending].flatMap((a) => {
      if (a.pending_revoke && a.pending_revoke.retry_count < BACKOFF_MS.length)
        return [a.pending_revoke.next_attempt_at ?? now()];
      if (a.state === "active" || a.state === "plan_use_off")
        return [
          Math.max(
            a.earliest_refresh_at ?? 0,
            a.next_attempt_at ?? 0,
            a.expires_at - 300_000 + Math.floor(random() * 60_000),
          ),
        ];
      return [];
    });
    if (!deadlines.length) return;
    // Avoid a zero-delay loop even for a token already inside its refresh window.
    timer = timers.set(
      () => {
        void tick().catch((error) => {
          backgroundError =
            error instanceof ChatGptError ? error.code : "storage_failed";
        });
      },
      Math.max(1000, Math.min(2_147_483_647, Math.min(...deadlines) - now())),
    );
    timer?.unref?.();
  }
  async function start() {
    if (!policy.enabled) return status();
    await tick();
    return status();
  }
  async function wake() {
    try {
      await tick();
    } catch (error) {
      backgroundError =
        error instanceof ChatGptError ? error.code : "storage_failed";
    }
  }
  function stop() {
    stopped = true;
    cancel();
    timers.clear(timer);
    for (const id of flights.keys()) bump(id);
  }
  return {
    status,
    connect,
    cancel,
    select,
    disconnect,
    refresh,
    start,
    resume: tick,
    wake,
    stop,
    policy,
  };
}
