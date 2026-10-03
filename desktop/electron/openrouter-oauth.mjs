import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const API = "https://openrouter.ai/api/v1";
const MAX_JSON_BYTES = 8 * 1024 * 1024;

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
    balance: null,
    limit: finite(data.limit),
    limitRemaining: finite(data.limit_remaining),
    freeRemaining: finite(data.free_model_daily_requests?.remaining),
    freeLimit: finite(data.free_model_daily_requests?.limit),
    freeTier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
  };
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
  account.freeTier === false &&
  (account.balance === null || account.balance > 0) &&
  account.limitRemaining !== 0;
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
}) {
  let active = null;

  async function json(path, key, attempt, body) {
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
        AbortSignal.timeout(30_000),
      ]),
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 401 || response.status === 403
          ? "OpenRouter did not authorize this connection. Sign in again."
          : "Could not reach OpenRouter. Try again.",
      );
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
  async function accountAndModels(key, attempt, knownModels) {
    const account = parseAccount(await json("/key", key, attempt));
    try {
      const credits = await json("/credits", key, attempt);
      const total = finite(credits?.data?.total_credits);
      const used = finite(credits?.data?.total_usage);
      if (total !== null && used !== null)
        account.balance = Math.max(0, total - used);
    } catch (error) {
      // Ordinary OAuth keys can lack management permission. The balance stays unknown.
      check(attempt);
      if (error.status !== 401 && error.status !== 403)
        account.metadataWarning =
          "Connection saved. Balance is unavailable. Refresh the connection to try again.";
    }
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
    const result = await invoke("set_global_agent_config", {
      config: {
        ...config,
        provider: "openrouter",
        model,
        preferred_runtime: "buzz-agent",
        env_vars: { ...config.env_vars, OPENROUTER_API_KEY: key },
      },
    });
    return result.failed_restart_count ?? 0;
  }
  async function run(action, duration = 30_000) {
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
          message: "OpenRouter sign-in timed out. Try again.",
        };
      // Never surface network URLs, provider bodies, auth codes or credentials.
      return {
        status: "error",
        message: attempt.saving
          ? "Could not finish saving OpenRouter. Refresh the connection before trying again."
          : "OpenRouter sign-in did not finish. Try again.",
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
    active.controller.abort("cancel");
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
      const server = createServer(
        { maxHeaderSize: 8192 },
        (request, response) => {
          response.setHeader("Cache-Control", "no-store");
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
            request.headers.host !== attempt.host ||
            url.pathname !== "/callback" ||
            !validState ||
            url.searchParams.getAll("state").length !== 1 ||
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
          const codes = url.searchParams.getAll("code");
          if (codes.length > 1 || (codes[0] && codes[0].length > 4096)) {
            response.writeHead(400).end("Invalid callback");
            return;
          }
          consumed = true;
          response.end("Return to Colony to finish connecting OpenRouter.");
          accept(url.searchParams.has("error") ? null : codes[0] || null);
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
      attempt.host = `127.0.0.1:${server.address().port}`;
      const redirect = new URL(`http://${attempt.host}/callback`);
      // Embed state in callback_url, without relying on an undocumented top-level echo.
      redirect.searchParams.set("state", state);
      const auth = new URL("https://openrouter.ai/auth");
      auth.searchParams.set("callback_url", redirect.href);
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
        ({ account } = await accountAndModels(key, attempt, models));
        metadataWarning = account.metadataWarning ?? null;
      } catch {
        check(attempt);
        // Preserve the new credential through the existing atomic defaults save,
        // even when a later metadata read fails. Refresh can recover it.
        account = {
          balance: null,
          limit: null,
          limitRemaining: null,
          freeRemaining: null,
          freeLimit: null,
          freeTier: null,
        };
        metadataWarning =
          "Connection saved. Balance and limits are unavailable. Refresh the connection to try again.";
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
        metadataWarning,
      };
    }, timeoutMs);
  }
  async function read(attempt) {
    const config = await invoke("get_global_agent_config", {});
    if (!config.env_vars?.OPENROUTER_API_KEY) return null;
    const { account, models } = await accountAndModels(
      config.env_vars.OPENROUTER_API_KEY,
      attempt,
    );
    return { config, account, models };
  }
  async function status() {
    return run(async (attempt) => {
      const data = await read(attempt);
      return data
        ? publicStatus(data.account, data.models, data.config.model)
        : { status: "unlinked" };
    });
  }
  async function select(model) {
    if (typeof model !== "string")
      throw new Error("Choose an OpenRouter model.");
    return run(async (attempt) => {
      const data = await read(attempt);
      const selected = data?.models.find((candidate) => candidate.id === model);
      if (!selected || !usable(selected, data.account))
        throw new Error("Choose an available model.");
      const failedRestarts = await persist(
        data.config.env_vars.OPENROUTER_API_KEY,
        model,
        attempt,
      );
      return publicStatus(data.account, data.models, model, failedRestarts);
    });
  }
  async function testConnection() {
    return run(async (attempt) => {
      const data = await read(attempt);
      if (data?.config.provider !== "openrouter")
        throw new Error("Connect OpenRouter first.");
      const testResult = await invoke("test_ai_connection", {
        config: data.config,
      });
      check(attempt);
      const state = publicStatus(data.account, data.models, data.config.model);
      if (testResult === "insufficient-balance") state.status = "limit";
      return { ...state, testResult };
    });
  }
  return { connect, cancel, status, select, test: testConnection };
}
