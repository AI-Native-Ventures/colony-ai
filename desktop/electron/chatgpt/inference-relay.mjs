import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createPlanState } from "./plan-state.mjs";
import {
  planPreviewHeaders,
  validatePlanRequest,
  PLAN_LIMIT_MESSAGE,
} from "./inference-policy.mjs";
import { ChatGptError } from "./policy.mjs";
import { createPlanSse } from "./sse.mjs";

const LIMIT = "subscription_sharing_usage_limit_exceeded";
const UNAVAILABLE = "subscription_sharing_usage_unavailable";
const opaque = () => randomBytes(32).toString("base64url");
const same = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const codeOf = (body) => body?.error?.code ?? body?.response?.error?.code;
const safeCode = (code) =>
  [
    LIMIT,
    UNAVAILABLE,
    "subscription_sharing_unsupported_capability",
    "model_not_found",
  ].includes(code)
    ? code
    : "plan_request_failed";

async function readBounded(stream, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stream ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new ChatGptError("request_too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function fail(response, error) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const code =
    error instanceof ChatGptError ? error.code : "plan_request_failed";
  response
    .writeHead(error.status || 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .end(
      JSON.stringify({
        error: { code, message: code === LIMIT ? PLAN_LIMIT_MESSAGE : code },
      }),
    );
}

/** Install-scoped main-process relay. Children get local capabilities only. */
export async function createChatGptRelay({
  service,
  store,
  env = {},
  now = Date.now,
  fetchImpl = fetch,
  maxInflight = 2,
  timeoutMs = 300_000,
  maxBodyBytes = 1024 * 1024,
  maxStreamBytes = 32 * 1024 * 1024,
  maxFrameBytes = 1024 * 1024,
} = {}) {
  if (!service.policy.enabled) throw new ChatGptError("feature_disabled");
  for (const [n, ceiling] of [
    [maxInflight, 2],
    [timeoutMs, 300_000],
    [maxBodyBytes, 1024 * 1024],
    [maxStreamBytes, 32 * 1024 * 1024],
    [maxFrameBytes, 1024 * 1024],
  ])
    if (!Number.isInteger(n) || n < 1 || n > ceiling)
      throw new ChatGptError("invalid_relay_limit");
  const preview = planPreviewHeaders(env);
  const state = createPlanState({ store, now });
  const routes = new Map();
  let closed = false;
  let active = 0;
  let origin;

  async function authorized(id, signal, path, body) {
    if (closed) throw new ChatGptError("relay_closed");
    let lease = await service.authorizeInference(id);
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      await lease.assertCurrent();
      if (closed) throw new ChatGptError("relay_closed");
      result = await fetchImpl(`${service.policy.resource}${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${lease.token}`,
          Accept: body ? "text/event-stream" : "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                originator: "Colony",
                ...preview,
              }
            : {}),
        },
        ...(body ? { body } : {}),
      });
      try {
        await lease.assertCurrent();
        if (closed) throw new ChatGptError("relay_closed");
      } catch (error) {
        await result.body?.cancel();
        throw error;
      }
      if (result.status !== 401) return { result, lease };
      await result.body?.cancel();
      if (attempt === 1) {
        await service.rejectInference(id, lease.token);
        throw new ChatGptError("plan_not_ready", 401);
      }
      lease = await service.authorizeInference(id, {
        rejectedToken: lease.token,
      });
    }
    throw new ChatGptError("plan_not_ready", 401);
  }
  async function errorResponse(id, result) {
    let body;
    try {
      body = JSON.parse(
        (await readBounded(result.body, maxFrameBytes)).toString("utf8"),
      );
    } catch (error) {
      if (error instanceof ChatGptError) throw error;
      throw new ChatGptError("invalid_plan_response", 502);
    }
    const code = safeCode(codeOf(body));
    if (code === LIMIT || code === UNAVAILABLE || result.status >= 500)
      await state.fail(id, code);
    throw new ChatGptError(code, result.status);
  }
  async function handle(request, response) {
    let route,
      controller,
      counted = false,
      upstreamStarted = false;
    try {
      if (closed) throw new ChatGptError("relay_closed", 503);
      // Compare the raw request target. URL normalization must not broaden it.
      route = routes.get(request.url);
      if (
        !route ||
        request.method !== "POST" ||
        request.headers.origin ||
        request.headers.host !== new URL(origin).host ||
        !same(request.headers.authorization, `Bearer ${route.key}`)
      )
        throw new ChatGptError("relay_denied", 403);
      if (
        request.headers["content-type"]?.split(";")[0].trim() !==
        "application/json"
      )
        throw new ChatGptError("unsupported_plan_request", 400);
      await state.assertReady(route.accountId);
      if (active >= maxInflight)
        throw new ChatGptError("inference_relay_busy", 503);
      active++;
      counted = true;
      controller = new AbortController();
      route.controllers.add(controller);
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(timeoutMs),
      ]);
      const onAbort = () => request.destroy();
      signal.addEventListener("abort", onAbort, { once: true });
      response.once("close", () => {
        if (!response.writableEnded) controller.abort();
      });
      try {
        const buffer = await readBounded(request, maxBodyBytes);
        let body;
        try {
          body = JSON.parse(buffer.toString("utf8"));
        } catch {
          throw new ChatGptError("unsupported_plan_request", 400);
        }
        validatePlanRequest(body);
        const circuitFailures = await state.assertReady(route.accountId);
        upstreamStarted = true;
        const { result, lease } = await authorized(
          route.accountId,
          signal,
          "/responses",
          JSON.stringify(body),
        );
        if (!result.ok) await errorResponse(route.accountId, result);
        if (
          !result.headers.get("content-type")?.startsWith("text/event-stream")
        ) {
          await result.body?.cancel();
          throw new ChatGptError("invalid_plan_response", 502);
        }
        const monitor = createPlanSse({ maxFrameBytes });
        let bytes = 0;
        for await (const chunk of result.body ?? []) {
          bytes += chunk.byteLength;
          if (bytes > maxStreamBytes)
            throw new ChatGptError("stream_too_large");
          await lease.assertCurrent();
          for (const event of monitor.feed(chunk)) {
            const code = safeCode(codeOf(event));
            if (event.type === "response.failed" || event.type === "error") {
              if (code === LIMIT || code === UNAVAILABLE)
                await state.fail(route.accountId, code);
              // Remote error prose may contain secrets or prompts. Send stable copy.
              if (event.response)
                event.response.error = {
                  code,
                  message: code === LIMIT ? PLAN_LIMIT_MESSAGE : code,
                };
              else event.error = { code, message: code };
            }
            if (event.type === "response.completed")
              await state.succeed(route.accountId, circuitFailures);
            if (!response.headersSent)
              response.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-store",
              });
            if (
              !response.write(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              )
            )
              await once(response, "drain", { signal });
          }
        }
        monitor.finish();
        response.end();
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      // Propagate as a failed response, including durable-state write failures.
      let failureToReport = error;
      if (
        upstreamStarted &&
        (!(error instanceof ChatGptError) ||
          [
            "stream_interrupted",
            "invalid_stream",
            "stream_too_large",
            "stream_frame_too_large",
            "invalid_plan_response",
          ].includes(error.code))
      ) {
        try {
          await state.fail(route.accountId, UNAVAILABLE);
        } catch (failure) {
          failureToReport = failure;
        }
      }
      fail(response, failureToReport);
    } finally {
      controller?.abort();
      if (controller) route?.controllers.delete(controller);
      if (counted) active--;
    }
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.maxConnections = 16;
  server.headersTimeout = 5000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 1000;
  server.on("upgrade", (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  let unsubscribe;
  try {
    unsubscribe = service.onRetire((id) => {
      for (const [target, route] of routes)
        if (id === null || route.accountId === id) {
          routes.delete(target);
          for (const controller of route.controllers) controller.abort();
        }
    });
  } catch (error) {
    await new Promise((resolve, reject) =>
      server.close((failure) => (failure ? reject(failure) : resolve())),
    );
    throw error;
  }
  return {
    state,
    async grant({ backend, communityId, agentId, accountId }) {
      if (closed) throw new ChatGptError("relay_closed");
      if (backend !== "local") throw new ChatGptError("remote_plan_disallowed");
      for (const id of [communityId, agentId])
        if (typeof id !== "string" || !id || id.length > 256)
          throw new ChatGptError("invalid_agent_scope");
      if (routes.size >= 64) throw new ChatGptError("relay_capacity");
      const lease = await service.authorizeInference(accountId);
      await state.status(accountId);
      await lease.assertCurrent();
      if (closed) throw new ChatGptError("relay_closed");
      if (routes.size >= 64) throw new ChatGptError("relay_capacity");
      const prefix = `/${opaque()}/v1`;
      const route = {
        accountId,
        communityId,
        agentId,
        key: opaque(),
        controllers: new Set(),
      };
      routes.set(`${prefix}/responses`, route);
      return {
        baseUrl: `${origin}${prefix}`,
        key: route.key,
        revoke() {
          routes.delete(`${prefix}/responses`);
          for (const controller of route.controllers) controller.abort();
        },
      };
    },
    async models(accountId) {
      const signal = AbortSignal.timeout(Math.min(timeoutMs, 15_000));
      const { result, lease } = await authorized(accountId, signal, "/models");
      if (!result.ok) await errorResponse(accountId, result);
      let data;
      try {
        data = JSON.parse(
          (await readBounded(result.body, maxFrameBytes)).toString("utf8"),
        );
      } catch (error) {
        if (error instanceof ChatGptError) throw error;
        throw new ChatGptError("invalid_models");
      }
      if (!Array.isArray(data.models) || data.models.length > 256)
        throw new ChatGptError("invalid_models");
      const models = [];
      for (const model of data.models)
        if (model.visibility === "list") {
          if (
            typeof model.slug !== "string" ||
            !/^[A-Za-z0-9._:-]{1,200}$/.test(model.slug) ||
            typeof model.display_name !== "string" ||
            model.display_name.length > 200
          )
            throw new ChatGptError("invalid_models");
          models.push({ slug: model.slug, displayName: model.display_name });
        }
      await lease.assertCurrent();
      await state.saveModels(accountId, models);
      return models;
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const route of routes.values())
        for (const controller of route.controllers) controller.abort();
      routes.clear();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
