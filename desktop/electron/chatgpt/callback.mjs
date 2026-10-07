import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  CALLBACK_PATH,
  ChatGptError,
  SCOPES,
  validClientId,
} from "./policy.mjs";
import { equalSecret } from "./id-token.mjs";

/** Bind before opening the browser; accept exactly one valid loopback callback. */
export async function startChatGptCallback({
  policy,
  hostId,
  account,
  consent,
  signal,
  timeoutMs = 600_000,
  port = 0,
}) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  let consumed = false;
  let expectedHost;
  let accept;
  let reject;
  const result = new Promise((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  // The caller may still be awaiting listen or browser startup when this rejects.
  void result.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    let url;
    try {
      url = new URL(request.url, "http://127.0.0.1");
    } catch {
      response.writeHead(400).end("Invalid callback");
      return;
    }
    const params = url.searchParams;
    if (
      consumed ||
      signal.aborted ||
      request.method !== "GET" ||
      request.headers.host !== expectedHost ||
      url.pathname !== CALLBACK_PATH ||
      params.getAll("state").length !== 1 ||
      !equalSecret(params.get("state"), state)
    ) {
      response.writeHead(400).end("Invalid callback. Return to Colony.");
      return;
    }
    if (
      ["code", "client_id", "error"].some(
        (key) => params.getAll(key).length > 1,
      )
    ) {
      response.writeHead(400).end("Invalid callback");
      return;
    }
    const error = params.get("error");
    const clientId = params.get("client_id") ?? account?.client_id;
    const code = params.get("code");
    if (error && code) {
      response.writeHead(400).end("Invalid callback");
      return;
    }
    if (
      !error &&
      (!code ||
        code.length > 4096 ||
        !validClientId(clientId) ||
        (account && clientId !== account.client_id))
    ) {
      consumed = true;
      response.writeHead(400).end("Registration incomplete. Return to Colony.");
      reject(new ChatGptError("invalid_callback"));
      server.close();
      return;
    }
    consumed = true;
    response.end("Return to Colony.");
    server.close();
    if (error) {
      if (error === "access_denied") accept(null);
      else reject(new ChatGptError("authorization_failed"));
    } else accept({ code, clientId, nonce, verifier, redirectUri });
  });
  server.maxConnections = 8;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1;
  const cancel = () => {
    consumed = true;
    reject(new ChatGptError("cancelled"));
    server.close();
    server.closeAllConnections();
  };
  signal.addEventListener("abort", cancel, { once: true });
  let timer;
  let redirectUri;
  try {
    await new Promise((resolve, fail) => {
      server.once("error", fail);
      server.listen(port, "127.0.0.1", resolve);
    });
    server.removeAllListeners("error");
    server.on("error", () => {
      reject(new ChatGptError("listener_failed"));
      cancel();
    });
    if (signal.aborted) throw new ChatGptError("cancelled");
    expectedHost = `127.0.0.1:${server.address().port}`;
    redirectUri = `http://${expectedHost}${CALLBACK_PATH}`;
    timer = setTimeout(() => {
      reject(new ChatGptError("listener_timeout"));
      server.close();
      server.closeAllConnections();
    }, timeoutMs);
    const auth = new URL(`${policy.auth}/api/accounts/authorize`);
    const params = {
      client_id: account?.client_id ?? "dynamic_agent_client",
      ext_agent_host_id: hostId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: policy.resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
    if (!account) params.agent_name_hint = "Colony";
    if (account?.id_token) params.id_token_hint = account.id_token;
    if (account?.email) params.login_hint = account.email;
    if (consent) params.prompt = "consent";
    for (const [key, value] of Object.entries(params))
      auth.searchParams.set(key, value);
    return {
      url: auth.href,
      result,
      close: () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        server.close();
        server.closeAllConnections();
      },
    };
  } catch (error) {
    signal.removeEventListener("abort", cancel);
    server.close();
    server.closeAllConnections();
    throw error instanceof ChatGptError
      ? error
      : new ChatGptError("listener_failed");
  }
}
