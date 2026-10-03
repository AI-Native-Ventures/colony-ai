import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const API = "https://openrouter.ai/api/v1";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const BALANCE_RETRY_MS = 5 * 60 * 1000;
const MAX_BALANCE_KEYS = 32;

/** RFC 7636 S256; the verifier stays in the trusted main process. */
export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}
/** Generate a 384-bit, URL-safe verifier and its matching challenge. */
export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}
/** Validate the exchange response without reflecting provider-controlled fields. */
export function parseExchangeKey(value) {
  if (
    typeof value?.key !== "string" ||
    !value.key.trim() ||
    /\s/.test(value.key) ||
    value.key.length > 4096
  )
    throw new Error(
      "OpenRouter returned an invalid sign-in response. Try again.",
    );
  return value.key;
}
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
/** Project public quota fields, keeping absent measurements unknown. */
export function parseAccount(value) {
  if (!value?.data || typeof value.data !== "object")
    throw new Error("Could not read your OpenRouter account. Try again.");
  const data = value.data;
  return {
    usage: finite(data.usage),
    freeUsed: finite(data.free_model_daily_requests?.used),
    limit: finite(data.limit),
    limitRemaining: finite(data.limit_remaining),
    freeRemaining: finite(data.free_model_daily_requests?.remaining),
    freeLimit: finite(data.free_model_daily_requests?.limit),
    freeTier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
  };
}
/** Read the account balance only from a complete, finite credits response. */
export function parseCredits(value) {
  const credits = finite(value?.data?.total_credits);
  const usage = finite(value?.data?.total_usage);
  if (credits === null || usage === null)
    throw new Error("OpenRouter account balance is unavailable.");
  return credits - usage;
}
/** Project tool-capable text models and classify free pricing from the catalogue. */
export function parseModels(value) {
  if (!Array.isArray(value?.data))
    throw new Error("Could not load OpenRouter models. Try again.");
  const models = value.data
    .filter(
      (model) =>
        typeof model.id === "string" &&
        model.id.length <= 256 &&
        model.supported_parameters?.includes("tools") &&
        (!model.architecture?.output_modalities ||
          model.architecture.output_modalities.includes("text")),
    )
    .map((model) => ({
      id: model.id,
      name: typeof model.name === "string" ? model.name : model.id,
      free:
        model.pricing?.prompt != null &&
        model.pricing?.completion != null &&
        Number(model.pricing.prompt) === 0 &&
        Number(model.pricing.completion) === 0,
      context: finite(model.context_length) ?? 0,
    }));
  if (!models.length)
    throw new Error(
      "OpenRouter has no compatible models available. Try again later.",
    );
  return models;
}
const canPay = (account) =>
  account.freeTier === false && account.limitRemaining !== 0;
const usable = (model, account) =>
  model.free ? account.freeRemaining !== 0 : canPay(account);
function publicStatus(account, models, model, failedRestarts = 0) {
  const selected = models.find((candidate) => candidate.id === model);
  return {
    ...account,
    models,
    model,
    failedRestarts,
    status: selected && usable(selected, account) ? "connected" : "limit",
  };
}

/** Main-process OAuth plus the existing native defaults persistence seam. No key is returned to IPC callers. */
export function createOpenRouterService({
  openExternal,
  invoke,
  fetchImpl = fetch,
  timeoutMs = 600_000,
  bringToFront = () => {},
  createServerImpl = createServer,
  now = Date.now,
}) {
  let active = null;
  // Native-only, bounded cache. Fingerprints identify keys without retaining them.
  // Failed probes retry after five minutes rather than on every refresh.
  const balances = new Map();

  async function json(path, key, attempt, body, requestTimeoutMs = 30_000) {
    check(attempt);
    const response = await fetchImpl(`${API}${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([
        attempt.controller.signal,
        AbortSignal.timeout(requestTimeoutMs),
      ]),
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401 || response.status === 403
          ? "OpenRouter did not authorize this connection. Sign in again."
          : "Could not reach OpenRouter. Try again.",
      );
      await response.body?.cancel().catch(() => {});
      error.status = response.status;
      throw error;
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new Error("OpenRouter returned an unreadable response. Try again.");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_JSON_BYTES)
          throw new Error("OpenRouter returned too much data. Try again.");
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new Error(
          "OpenRouter returned an unreadable response. Try again.",
        );
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  function check(attempt) {
    if (active !== attempt || attempt.controller.signal.aborted)
      throw new Error("OpenRouter sign-in ended. Try again.");
  }
  async function balance(key, attempt, refresh) {
    const fingerprint = createHash("sha256").update(key).digest("hex");
    const cached = balances.get(fingerprint);
    if (!refresh || (cached?.retryAt && now() < cached.retryAt))
      return cached?.value ?? null;
    let value = null;
    try {
      // This endpoint normally requires a management key. A denial is optional
      // metadata failure, never a reason to unlink or replace the OAuth key.
      value = parseCredits(
        await json("/credits", key, attempt, undefined, 5000),
      );
    } catch {
      check(attempt);
    }
    check(attempt);
    balances.delete(fingerprint);
    balances.set(fingerprint, {
      value,
      retryAt: value === null ? now() + BALANCE_RETRY_MS : null,
    });
    if (balances.size > MAX_BALANCE_KEYS)
      balances.delete(balances.keys().next().value);
    return value;
  }
  async function accountAndModels(
    key,
    attempt,
    knownModels,
    refreshBalance = false,
  ) {
    const account = parseAccount(await json("/key", key, attempt));
    check(attempt);
    account.balance = await balance(key, attempt, refreshBalance);
    const models =
      knownModels ?? parseModels(await json("/models", key, attempt));
    check(attempt);
    return { account, models };
  }
  async function persist(key, model, attempt) {
    check(attempt);
    const config = await invoke("get_global_agent_config", {});
    check(attempt);
    // Cancellation is accepted until the atomic native persistence boundary.
    attempt.saving = true;
    clearTimeout(attempt.timer);
    const env = { ...config.env_vars, OPENROUTER_API_KEY: key };
    delete env.OPENROUTER_BASE_URL;
    const result = await invoke("set_global_agent_config", {
      config: {
        ...config,
        provider: "openrouter",
        model,
        preferred_runtime: "buzz-agent",
        env_vars: env,
      },
    });
    check(attempt);
    return result.failed_restart_count ?? 0;
  }
  async function run(action, duration = 30_000, operation = "sign-in") {
    if (active) throw new Error("An OpenRouter action is already running.");
    const attempt = { controller: new AbortController(), saving: false };
    active = attempt;
    attempt.timer = setTimeout(
      () => attempt.controller.abort("timeout"),
      duration,
    );
    try {
      return await action(attempt);
    } catch {
      if (attempt.controller.signal.reason === "cancel")
        return { status: "cancelled" };
      if (attempt.controller.signal.reason === "timeout")
        return {
          status: "error",
          message: `OpenRouter ${operation} timed out. Try again.`,
        };
      // Never surface network URLs, provider bodies, auth codes or credentials.
      return {
        status: "error",
        message: attempt.saving
          ? "Could not finish saving OpenRouter. Refresh the connection before trying again."
          : `OpenRouter ${operation} did not finish. Try again.`,
      };
    } finally {
      clearTimeout(attempt.timer);
      attempt.controller.abort();
      attempt.server?.closeAllConnections();
      attempt.server?.close();
      if (active === attempt) active = null;
    }
  }
  function cancel() {
    if (!active || active.saving) return false;
    const cancelled = active;
    active = null;
    cancelled.controller.abort("cancel");
    return true;
  }
  async function connect() {
    return run(async (attempt) => {
      const { verifier, challenge } = pkcePair();
      const state = randomBytes(32).toString("base64url");
      let consumed = false;
      let accept;
      const callback = new Promise((resolve, reject) => {
        accept = resolve;
        attempt.controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Authorization ended")),
          { once: true },
        );
      });
      // Install a rejection handler while listen/openExternal are still pending.
      callback.catch(() => {});
      const server = createServerImpl(
        { maxHeaderSize: 8192 },
        (request, response) => {
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.setHeader("Referrer-Policy", "no-referrer");
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          let url;
          try {
            url = new URL(request.url, "http://127.0.0.1");
          } catch {
            response.writeHead(400).end("Invalid callback");
            return;
          }
          const received = url.searchParams.get("state") ?? "";
          const validState =
            Buffer.byteLength(received) === Buffer.byteLength(state) &&
            timingSafeEqual(Buffer.from(received), Buffer.from(state));
          if (
            request.method !== "GET" ||
            !attempt.hosts.includes(request.headers.host) ||
            url.pathname !== "/callback" ||
            consumed ||
            attempt.controller.signal.aborted
          ) {
            response
              .writeHead(400)
              .end(
                "This sign-in request is no longer valid. Return to Colony.",
              );
            return;
          }
          // OpenRouter omits state on denial. It can cancel this loopback flow,
          // but can never exchange or persist a credential.
          if (
            url.searchParams.has("error") &&
            !url.searchParams.has("code") &&
            !url.searchParams.has("state")
          ) {
            consumed = true;
            response.end("Sign-in cancelled. Return to Colony.");
            accept(null);
            bringToFront();
            server.close();
            return;
          }
          if (!validState || url.searchParams.getAll("state").length !== 1) {
            response.writeHead(400).end("Invalid callback");
            return;
          }
          const codes = url.searchParams.getAll("code");
          if (codes.length > 1 || (codes[0] && codes[0].length > 4096)) {
            response.writeHead(400).end("Invalid callback");
            return;
          }
          consumed = true;
          response.end("Return to Colony to finish connecting OpenRouter.");
          accept(url.searchParams.has("error") ? null : codes[0] || null);
          bringToFront();
          server.close();
        },
      );
      attempt.server = server;
      server.maxConnections = 8;
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      server.keepAliveTimeout = 1;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      check(attempt);
      const port = server.address().port;
      attempt.hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      const redirect = new URL(`http://localhost:${port}/callback`);
      const auth = new URL("https://openrouter.ai/auth");
      auth.searchParams.set("callback_url", redirect.href);
      auth.searchParams.set("state", state);
      auth.searchParams.set("key_label", "Colony");
      auth.searchParams.set("code_challenge", challenge);
      auth.searchParams.set("code_challenge_method", "S256");
      await openExternal(auth.href);
      const code = await callback;
      if (!code) return { status: "cancelled" };
      check(attempt);
      // Load the compatible catalogue before creating a remote credential.
      const models = parseModels(await json("/models", null, attempt));
      const key = parseExchangeKey(
        await json("/auth/keys", null, attempt, {
          code,
          code_verifier: verifier,
          code_challenge_method: "S256",
        }),
      );
      let account;
      let metadataWarning = null;
      try {
        ({ account } = await accountAndModels(key, attempt, models, true));
        metadataWarning = account.metadataWarning ?? null;
      } catch (error) {
        check(attempt);
        if (error.status === 401 || error.status === 403)
          return {
            status: "reauth",
            message: "OpenRouter rejected this key. Sign in again.",
          };
        // Preserve the new credential through the existing atomic defaults save,
        // even when a later metadata read fails. Refresh can recover it.
        account = unknownAccount();
        metadataWarning =
          "Connection saved. Key limits are unavailable. Refresh the connection to try again.";
      }
      const ordered = [...models].sort(
        (a, b) => b.context - a.context || a.id.localeCompare(b.id),
      );
      const selected =
        ordered.find((model) => model.free && usable(model, account)) ??
        ordered.find((model) => usable(model, account)) ??
        ordered.find((model) => model.free) ??
        ordered[0];
      const failedRestarts = await persist(key, selected.id, attempt);
      return {
        ...publicStatus(account, models, selected.id, failedRestarts),
        ...(metadataWarning ? { status: "linked" } : {}),
        metadataWarning,
      };
    }, timeoutMs);
  }
  function unknownAccount() {
    return {
      balance: null,
      usage: null,
      freeUsed: null,
      limit: null,
      limitRemaining: null,
      freeRemaining: null,
      freeLimit: null,
      freeTier: null,
    };
  }
  async function read(attempt, refreshBalance = false) {
    const config = await invoke("get_global_agent_config", {});
    check(attempt);
    if (!config.env_vars?.OPENROUTER_API_KEY)
      return { outcome: { status: "unlinked" } };
    const base = config.env_vars.OPENROUTER_BASE_URL;
    if (base && base.replace(/\/+$/, "") !== API)
      return {
        outcome: {
          status: "unmanaged",
          message:
            "This key uses a custom OpenRouter address. Manage it under Bring your own key.",
        },
      };
    try {
      const { account, models } = await accountAndModels(
        config.env_vars.OPENROUTER_API_KEY,
        attempt,
        undefined,
        refreshBalance,
      );
      check(attempt);
      return { config, account, models };
    } catch (error) {
      check(attempt);
      if (error.status === 401 || error.status === 403)
        return {
          outcome: {
            status: "reauth",
            message: "OpenRouter rejected the saved key. Sign in again.",
          },
        };
      return {
        outcome: {
          ...unknownAccount(),
          status: "linked",
          provider: config.provider,
          model: config.model ?? "",
          models: [],
          failedRestarts: 0,
          metadataWarning:
            "Your OpenRouter connection is saved. Could not read key limits. Refresh to try again.",
        },
      };
    }
  }
  async function status() {
    return run(
      async (attempt) => {
        const data = await read(attempt, true);
        check(attempt);
        return (
          data.outcome ??
          publicStatus(data.account, data.models, data.config.model)
        );
      },
      30_000,
      "refresh",
    );
  }
  async function select(model) {
    if (typeof model !== "string")
      throw new Error("Choose an OpenRouter model.");
    return run(
      async (attempt) => {
        const data = await read(attempt);
        check(attempt);
        if (data.outcome) return data.outcome;
        const selected = data.models.find(
          (candidate) => candidate.id === model,
        );
        if (!selected || !usable(selected, data.account))
          throw new Error("Choose an available model.");
        const failedRestarts = await persist(
          data.config.env_vars.OPENROUTER_API_KEY,
          model,
          attempt,
        );
        return publicStatus(data.account, data.models, model, failedRestarts);
      },
      30_000,
      "model save",
    );
  }
  async function testConnection() {
    return run(
      async (attempt) => {
        const data = await read(attempt);
        check(attempt);
        if (data.outcome) return data.outcome;
        if (data.config.provider !== "openrouter")
          throw new Error("Connect OpenRouter first.");
        const testResult = await invoke("test_ai_connection", {
          config: data.config,
        });
        check(attempt);
        const state = publicStatus(
          data.account,
          data.models,
          data.config.model,
        );
        if (testResult === "insufficient-balance") state.status = "limit";
        return { ...state, testResult };
      },
      30_000,
      "connection test",
    );
  }
  return { connect, cancel, status, select, test: testConnection };
}
