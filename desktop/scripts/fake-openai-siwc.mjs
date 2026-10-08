import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { ISSUER, PLAN_SCOPE, SCOPES } from "../electron/chatgpt/policy.mjs";

const prohibited = new Set(
  "background conversation max_output_tokens max_tool_calls metadata moderation multi_agent prompt prompt_cache_retention safety_identifier temperature top_logprobs top_p truncation user previous_response_id".split(
    " ",
  ),
);
const opaque = () => randomBytes(32).toString("base64url");
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
let signingKeys;
function keys() {
  // Share only the fake signing key within this test process to bound CPU use.
  signingKeys ??= generateKeyPairSync("rsa", { modulusLength: 2048 });
  return signingKeys;
}

/** Local-only public-protocol fake. Never accepts or accesses real credentials. */
export async function createFakeOpenAi({
  now = Date.now,
  tools = "namespace",
} = {}) {
  const { privateKey, publicKey } = keys();
  let kid = "fake-key-1";
  let origin;
  let sequence = 0;
  const codes = new Map();
  const sessions = new Map();
  const registrations = new Map();
  const faults = {};
  const requests = [];
  const counters = {
    authorize: 0,
    exchange: 0,
    refresh: 0,
    revoke: 0,
    jwks: 0,
    responses: 0,
  };
  const jwt = (claims, header = {}) => {
    const input = `${encode({ alg: "RS256", kid, ...header })}.${encode(claims)}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
  };
  const json = (response, status, data) =>
    response
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(data));
  const fail = (response, code, status = 400, param) =>
    json(response, status, { error: { code, ...(param ? { param } : {}) } });
  function tokens(registration) {
    const access = opaque();
    const refresh = opaque();
    let scope = faults.noPlan ? SCOPES.replace(PLAN_SCOPE, "").trim() : SCOPES;
    if (faults.noOffline) scope = scope.replace("offline_access", "").trim();
    const claims = {
      iss: ISSUER,
      aud: registration.clientId,
      sub: registration.subject,
      email: registration.email,
      nonce: registration.nonce,
      iat: Math.floor(now() / 1000),
      exp: Math.floor(now() / 1000) + 3600,
      ...faults.claims,
    };
    const data = {
      access_token: access,
      refresh_token: refresh,
      id_token: jwt(claims, faults.header),
      token_type: "Bearer",
      scope,
      expires_in: faults.expiresIn ?? 3600,
      earliest_refresh_at: faults.earliestRefreshAt ?? Math.floor(now() / 1000),
    };
    if (faults.noOffline) delete data.refresh_token;
    if (faults.badSignature)
      data.id_token = `${data.id_token.slice(0, -10)}AAAAAAAAAA`;
    const session = { registration, access, refresh, valid: true, used: false };
    sessions.set(refresh, session);
    return data;
  }
  async function body(request) {
    let text = "";
    for await (const chunk of request) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 65536) throw new Error("too_large");
    }
    return text;
  }
  async function handle(request, response) {
    const url = new URL(request.url, origin);
    const path = url.pathname;
    if (requests.length >= 1024 || sessions.size >= 256 || codes.size >= 128)
      return fail(response, "fake_capacity", 503);
    // No URL query, bearer, code, nonce, verifier, email or token enters records.
    requests.push({ method: request.method, path });
    if (path === "/.well-known/openid-configuration")
      return json(response, 200, {
        issuer: faults.discoveryIssuer ?? ISSUER,
        authorization_endpoint: `${origin}/api/accounts/authorize`,
        token_endpoint: `${origin}/api/accounts/oauth/token`,
        revocation_endpoint: faults.revocationEndpoint ?? `${origin}/revoke`,
        jwks_uri: faults.jwksUri ?? `${origin}/.well-known/jwks.json`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (path === "/.well-known/jwks.json") {
      counters.jwks++;
      if (faults.jwksError)
        return fail(response, "temporarily_unavailable", 500);
      return json(response, 200, {
        keys: [
          {
            ...publicKey.export({ format: "jwk" }),
            kid,
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    }
    if (path === "/api/accounts/authorize" && request.method === "GET") {
      counters.authorize++;
      const p = url.searchParams;
      const redirect = new URL(p.get("redirect_uri"));
      const newClient = p.get("client_id") === "dynamic_agent_client";
      if (
        redirect.protocol !== "http:" ||
        redirect.hostname !== "127.0.0.1" ||
        redirect.pathname !== "/auth/callback" ||
        p.get("response_type") !== "code" ||
        p.get("resource") !== `${origin}/v1` ||
        p.get("code_challenge_method") !== "S256" ||
        !p.get("state") ||
        !p.get("nonce") ||
        !/^urn:uuid:/.test(p.get("ext_agent_host_id") ?? "") ||
        !SCOPES.split(" ").every((s) =>
          p.get("scope")?.split(" ").includes(s),
        ) ||
        (newClient
          ? p.get("agent_name_hint") !== "Colony"
          : p.has("agent_name_hint"))
      )
        return fail(response, "invalid_request");
      const clientId = newClient
        ? `oaiapp_mock_${++sequence}`
        : p.get("client_id");
      const registration = newClient
        ? {
            clientId,
            subject: `fake-subject-${sequence}`,
            email: "same@example.test",
          }
        : registrations.get(clientId);
      if (!registration) return fail(response, "invalid_client");
      registrations.set(clientId, registration);
      registration.nonce = p.get("nonce");
      redirect.searchParams.set(
        "state",
        faults.wrongState ? opaque() : p.get("state"),
      );
      if (faults.deny) redirect.searchParams.set("error", "access_denied");
      else {
        const code = opaque();
        codes.set(code, {
          registration: { ...registration },
          redirect: p.get("redirect_uri"),
          challenge: p.get("code_challenge"),
        });
        if (!faults.noCode) redirect.searchParams.set("code", code);
        if (!faults.omitClient)
          redirect.searchParams.set(
            "client_id",
            faults.wrongClient ? "oaiapp_wrong" : clientId,
          );
      }
      response.writeHead(302, { Location: redirect.href }).end();
      return;
    }
    if (path === "/api/accounts/oauth/token" && request.method === "POST") {
      const p = new URLSearchParams(await body(request));
      const refreshing = p.get("grant_type") === "refresh_token";
      counters[refreshing ? "refresh" : "exchange"]++;
      if (faults.holdToken) await faults.holdToken;
      if (faults.tokenError)
        return fail(response, faults.tokenError, faults.tokenStatus ?? 400);
      if (p.has("client_secret") || p.get("resource") !== `${origin}/v1`)
        return fail(response, "invalid_request");
      if (refreshing) {
        if (p.has("scope")) return fail(response, "invalid_scope");
        const session = sessions.get(p.get("refresh_token"));
        if (!session?.valid) return fail(response, "invalid_grant");
        if (session.used) return fail(response, "refresh_token_reused");
        if (session.registration.clientId !== p.get("client_id"))
          return fail(response, "invalid_client");
        session.used = true;
        json(response, 200, tokens(session.registration));
      } else {
        const code = codes.get(p.get("code"));
        if (!code) return fail(response, "invalid_grant");
        codes.delete(p.get("code"));
        if (
          code.registration.clientId !== p.get("client_id") ||
          code.redirect !== p.get("redirect_uri") ||
          createHash("sha256")
            .update(p.get("code_verifier") ?? "")
            .digest("base64url") !== code.challenge
        )
          return fail(response, "invalid_grant");
        json(response, 200, tokens(code.registration));
      }
      return;
    }
    if (path === "/revoke" && request.method === "POST") {
      counters.revoke++;
      const p = new URLSearchParams(await body(request));
      if (faults.revokeError)
        return fail(response, "temporarily_unavailable", 500);
      if (p.get("token_type_hint") !== "refresh_token")
        return fail(response, "invalid_request");
      const session = sessions.get(p.get("token"));
      if (session && session.registration.clientId !== p.get("client_id"))
        return fail(response, "invalid_client");
      if (session) session.valid = false;
      response.writeHead(200).end();
      return;
    }
    const bearer = request.headers.authorization?.replace(/^Bearer /, "");
    const session = [...sessions.values()].find(
      (s) => s.access === bearer && s.valid && !s.used,
    );
    if (path === "/v1/models" && request.method === "GET") {
      if (!session || faults.revoked)
        return fail(response, "subscription_sharing_invalid_user", 401);
      return json(response, 200, {
        models: [
          {
            slug: "fake-model",
            display_name: "Fake model",
            visibility: "list",
          },
          {
            slug: "hidden-model",
            display_name: "Hidden",
            visibility: "hidden",
          },
        ],
      });
    }
    if (path === "/v1/responses" && request.method === "POST") {
      counters.responses++;
      if (faults.responseRedirect) {
        response
          .writeHead(302, { Location: `${origin}/redirect-target` })
          .end();
        return;
      }
      if (!session || faults.revoked)
        return fail(response, "subscription_sharing_invalid_user", 401);
      const data = JSON.parse(await body(request));
      const invalid = Object.keys(data).find((k) => prohibited.has(k));
      if (
        invalid ||
        data.store !== false ||
        data.stream !== true ||
        !Array.isArray(data.input) ||
        data.input.some((item) => item.role === "system")
      )
        return fail(
          response,
          "subscription_sharing_unsupported_capability",
          400,
          invalid ?? "input",
        );
      if (
        data.tools?.some(
          (tool) =>
            tools === "none" ||
            tools === "additional" ||
            (tools === "namespace"
              ? tool.type !== "namespace" ||
                !Array.isArray(tool.tools) ||
                tool.tools.some(
                  (nested) => !["function", "custom"].includes(nested.type),
                )
              : !["function", "custom"].includes(tool.type)),
        )
      )
        return fail(
          response,
          "subscription_sharing_unsupported_capability",
          400,
          "tools",
        );
      if (
        data.input.some(
          (item) =>
            item.type === "additional_tools" &&
            (tools === "none" ||
              !Array.isArray(item.tools) ||
              item.tools.some(
                (tool) => !["function", "custom"].includes(tool.type),
              )),
        )
      )
        return fail(
          response,
          "subscription_sharing_unsupported_capability",
          400,
          "input",
        );
      const input = JSON.stringify(data.input);
      if (input.includes("[[revoked]]")) {
        session.valid = false;
        return fail(response, "subscription_sharing_invalid_user", 401);
      }
      if (input.includes("[[ineligible]]"))
        return fail(response, "subscription_sharing_user_not_eligible", 403);
      if (input.includes("[[503]]"))
        return json(response, 503, { detail: "Fake route unavailable" });
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      const event = (type, fields = {}) =>
        response.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`,
        );
      event("response.created", { response: { id: "fake-response" } });
      event("response.output_text.delta", { delta: "Fake " });
      event("response.output_text.delta", { delta: "answer" });
      if (input.includes("[[cut]]")) {
        response.destroy();
        return;
      }
      if (input.includes("[[limit]]") || input.includes("[[unavail]]")) {
        event("response.failed", {
          response: {
            error: {
              code: input.includes("[[limit]]")
                ? "subscription_sharing_usage_limit_exceeded"
                : "subscription_sharing_usage_unavailable",
            },
          },
        });
      } else if (input.includes("[[incomplete]]"))
        event("response.incomplete", { response: { status: "incomplete" } });
      else {
        const output =
          input.includes("[[tool]]") &&
          !data.input.some((item) => item.type === "function_call_output")
            ? [
                {
                  type: "function_call",
                  call_id: "fake-call",
                  name: "get_time",
                  arguments: "{}",
                },
              ]
            : [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Fake answer" }],
                },
              ];
        for (const item of output) event("response.output_item.done", { item });
        event("response.completed", {
          response: { id: "fake-response", status: "completed", output },
        });
      }
      response.end();
      return;
    }
    fail(response, "subscription_sharing_route_not_supported", 403);
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) fail(response, "invalid_request");
      else response.destroy();
    });
  });
  server.maxConnections = 16;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    faults,
    counters,
    requests,
    jwt,
    rotateKey: () => {
      kid = `fake-key-${++sequence}`;
    },
    invalidateSessions: () => {
      for (const session of sessions.values()) session.valid = false;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const fake = await createFakeOpenAi();
  console.log(
    JSON.stringify({ authOrigin: fake.origin, apiOrigin: fake.origin }),
  );
  for (const event of ["SIGINT", "SIGTERM"])
    process.once(event, () => {
      void fake.close();
    });
}
