import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  AGENT_NAME_HINT,
  API_ORIGIN,
  AUTH_ORIGIN,
  CALLBACK_PATH,
  DEFAULT_ENDPOINTS,
  DYNAMIC_CLIENT_ID,
  MAX_INFERENCE_REQUESTS,
  PROHIBITED_FIELDS,
  SCOPE,
  SecretRegistry,
  applyEvent,
  assertSupportedBody,
  buildAuthorizeUrl,
  buildReplayBody,
  buildTextBody,
  buildToolBody,
  checkOwnerRun,
  codeChallengeFor,
  createHttp,
  createScratch,
  deriveReading,
  describeInference,
  drainSse,
  installCleanupHandlers,
  loadOrCreateHostId,
  makeRow,
  newAttemptSecrets,
  newStreamSummary,
  renderReport,
  runProbe,
  sanitizeText,
  startCallbackListener,
  sweepStaleScratch,
  TOOL_VARIANTS,
  validateIdToken,
  withScratch,
  writePrivateFileAtomic,
} from "./siwc-probe.mjs";

const SCRIPT = path.join(import.meta.dirname, "siwc-probe.mjs");
const isWindows = process.platform === "win32";
// Built from a code point so this file never contains the character itself.
const EM_DASH = String.fromCharCode(0x2014);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempParent(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "siwc-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function signJwt({ header, payload, key, alg = "RS256" }) {
  const input = `${b64(header)}.${b64(payload)}`;
  const signature =
    alg === "RS256"
      ? cryptoSign("RSA-SHA256", Buffer.from(input), key)
      : cryptoSign("sha256", Buffer.from(input), {
          key,
          dsaEncoding: "ieee-p1363",
        });
  return `${input}.${signature.toString("base64url")}`;
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = {
  ...rsa.publicKey.export({ format: "jwk" }),
  kid: "k1",
  alg: "RS256",
  use: "sig",
};
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecJwk = {
  ...ec.publicKey.export({ format: "jwk" }),
  kid: "e1",
  alg: "ES256",
};

function request(port, pathAndQuery, { host, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathAndQuery,
        method,
        headers: { host: host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// PKCE, URL, per-attempt secrets
// ---------------------------------------------------------------------------

test("PKCE S256 challenge matches the RFC 7636 appendix B vector", () => {
  assert.equal(
    codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("attempt secrets: verifier and challenge agree and are base64url without padding", () => {
  const secrets = newAttemptSecrets();
  assert.match(secrets.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(secrets.challenge, codeChallengeFor(secrets.verifier));
  assert.equal(
    secrets.challenge,
    createHash("sha256").update(secrets.verifier).digest("base64url"),
  );
  assert.doesNotMatch(secrets.challenge, /=/);
});

test("state, nonce and PKCE verifier are fresh on every attempt", () => {
  const seen = { state: new Set(), nonce: new Set(), verifier: new Set() };
  for (let i = 0; i < 200; i += 1) {
    const secrets = newAttemptSecrets();
    for (const key of Object.keys(seen)) seen[key].add(secrets[key]);
    assert.notEqual(secrets.state, secrets.nonce);
  }
  for (const key of Object.keys(seen)) assert.equal(seen[key].size, 200, key);
});

const URL_INPUT = {
  clientId: DYNAMIC_CLIENT_ID,
  agentNameHint: AGENT_NAME_HINT,
  hostId: "urn:uuid:3f0f4c0e-6a5c-4a43-9c3a-0d4f4d6a7b11",
  redirectUri: "http://127.0.0.1:54321/auth/callback",
  state: "state-value",
  nonce: "nonce-value",
  challenge: "challenge-value",
};

test("authorize URL carries exactly the documented parameters and nothing else", () => {
  const url = new URL(buildAuthorizeUrl(URL_INPUT));
  assert.equal(
    `${url.origin}${url.pathname}`,
    `${AUTH_ORIGIN}/api/accounts/authorize`,
  );
  const params = Object.fromEntries(url.searchParams);
  assert.deepEqual(Object.keys(params).sort(), [
    "agent_name_hint",
    "client_id",
    "code_challenge",
    "code_challenge_method",
    "ext_agent_host_id",
    "nonce",
    "redirect_uri",
    "resource",
    "response_type",
    "scope",
    "state",
  ]);
  assert.deepEqual(params, {
    client_id: "dynamic_agent_client",
    agent_name_hint: "Colony",
    ext_agent_host_id: URL_INPUT.hostId,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:54321/auth/callback",
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state: "state-value",
    nonce: "nonce-value",
    code_challenge_method: "S256",
    code_challenge: "challenge-value",
  });
  assert.equal(params.scope, SCOPE);
});

test("authorize URL percent-encodes values and omits agent_name_hint when absent", () => {
  const raw = buildAuthorizeUrl({ ...URL_INPUT, agentNameHint: undefined });
  assert.match(raw, /scope=openid%20profile%20email/);
  assert.match(
    raw,
    /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A54321%2Fauth%2Fcallback/,
  );
  assert.equal(new URL(raw).searchParams.has("agent_name_hint"), false);
});

test("authorize URL refuses localhost, a wrong path or a non-http scheme", () => {
  for (const redirectUri of [
    "http://localhost:1455/auth/callback",
    "http://127.0.0.1:1455/callback",
    "https://127.0.0.1:1455/auth/callback",
    "http://127.0.0.1/auth/callback",
    "http://127.0.0.1:1455/auth/callback?x=1",
  ]) {
    assert.throws(
      () => buildAuthorizeUrl({ ...URL_INPUT, redirectUri }),
      /redirect_uri/,
    );
  }
});

// ---------------------------------------------------------------------------
// Loopback listener
// ---------------------------------------------------------------------------

test("listener binds 127.0.0.1 only and the redirect uses the exact path", async () => {
  const listener = await startCallbackListener({
    expectedState: "s",
    timeoutMs: 5000,
  });
  try {
    const address = listener.server.address();
    assert.equal(address.address, "127.0.0.1");
    assert.equal(address.family, "IPv4");
    assert.equal(
      listener.redirectUri,
      `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    );
  } finally {
    listener.close();
  }
});

test("listener rejects a wrong path, host, method and state without consuming the attempt", async () => {
  const listener = await startCallbackListener({
    expectedState: "good-state",
    timeoutMs: 5000,
  });
  try {
    const { port } = listener;
    assert.equal(
      (await request(port, "/callback?code=x&state=good-state")).status,
      404,
    );
    assert.equal(
      (await request(port, "/auth/callback/extra?code=x&state=good-state"))
        .status,
      404,
    );
    assert.equal(
      (
        await request(port, "/auth/callback?code=x&state=good-state", {
          host: `localhost:${port}`,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(port, "/auth/callback?code=x&state=good-state", {
          method: "POST",
        })
      ).status,
      405,
    );
    assert.equal(
      (await request(port, "/auth/callback?code=x&state=bad-state")).status,
      400,
    );
    assert.equal((await request(port, "/auth/callback?code=x")).status, 400);
    // Still listening: a valid callback now succeeds.
    const ok = await request(
      port,
      "/auth/callback?code=the-code&state=good-state&client_id=oaiapp_1&scope=a+b",
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(await listener.result, {
      kind: "code",
      code: "the-code",
      clientId: "oaiapp_1",
      scope: "a b",
    });
  } finally {
    listener.close();
  }
});

test("listener consumes one valid callback only", async () => {
  const listener = await startCallbackListener({
    expectedState: "s1",
    timeoutMs: 5000,
  });
  const { port } = listener;
  assert.equal(
    (await request(port, "/auth/callback?code=c&state=s1&client_id=oaiapp_x"))
      .status,
    200,
  );
  await listener.result;
  // The server closes right after; a second request is either refused or gets 410.
  const second = await request(port, "/auth/callback?code=c&state=s1").catch(
    () => ({ status: "closed" }),
  );
  assert.ok(
    second.status === 410 || second.status === "closed",
    String(second.status),
  );
});

test("listener reports access_denied only after validating state", async () => {
  const listener = await startCallbackListener({
    expectedState: "s2",
    timeoutMs: 5000,
  });
  const { port } = listener;
  assert.equal(
    (await request(port, "/auth/callback?error=access_denied&state=wrong"))
      .status,
    400,
  );
  assert.equal(
    (await request(port, "/auth/callback?error=access_denied&state=s2")).status,
    200,
  );
  assert.deepEqual(await listener.result, {
    kind: "error",
    error: "access_denied",
  });
});

test("listener times out and can be closed", async () => {
  const quick = await startCallbackListener({
    expectedState: "s",
    timeoutMs: 30,
  });
  assert.deepEqual(await quick.result, { kind: "timeout" });
  const closed = await startCallbackListener({
    expectedState: "s",
    timeoutMs: 5000,
  });
  closed.close();
  assert.deepEqual(await closed.result, { kind: "closed" });
});

// ---------------------------------------------------------------------------
// ID token validation against a local key pair, served as a JWKS by a local issuer
// ---------------------------------------------------------------------------

function startIssuer(jwks) {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, hits: () => hits, close: () => server.close() });
    });
  });
}

const NOW = 1_800_000_000;
const ISS = "https://issuer.test";
const CLIENT = "oaiapp_client";
const baseClaims = (overrides = {}) => ({
  iss: ISS,
  aud: CLIENT,
  sub: "subject-1",
  iat: NOW - 10,
  exp: NOW + 3000,
  nonce: "the-nonce",
  email: "person@example.test",
  ...overrides,
});

async function validate(
  t,
  { token, jwks = { keys: [rsaJwk] }, algs = ["RS256"], nonce = "the-nonce" },
) {
  const issuer = await startIssuer(jwks);
  t.after(() => issuer.close());
  const client = createHttp({ allowedOrigins: [issuer.origin] });
  let forced = 0;
  const getJwks = async (force) => {
    if (force) forced += 1;
    const reply = await client.text(`${issuer.origin}/jwks.json`);
    return reply.json;
  };
  const verdict = await validateIdToken({
    idToken: token,
    getJwks,
    issuer: ISS,
    clientId: CLIENT,
    nonce,
    nowSeconds: NOW,
    allowedAlgs: algs,
  });
  return { verdict, forced };
}

test("ID token: a correctly signed token with the right claims passes (RS256)", async (t) => {
  const token = signJwt({
    header: { alg: "RS256", kid: "k1" },
    payload: baseClaims(),
    key: rsa.privateKey,
  });
  const { verdict } = await validate(t, { token });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.claims.sub, "subject-1");
});

test("ID token: ES256 passes when the discovery document lists it", async (t) => {
  const token = signJwt({
    header: { alg: "ES256", kid: "e1" },
    payload: baseClaims(),
    key: ec.privateKey,
    alg: "ES256",
  });
  const { verdict } = await validate(t, {
    token,
    jwks: { keys: [ecJwk] },
    algs: ["ES256"],
  });
  assert.equal(verdict.ok, true);
});

test("ID token: every documented check rejects", async (t) => {
  const good = (overrides = {}, header = { alg: "RS256", kid: "k1" }) =>
    signJwt({ header, payload: baseClaims(overrides), key: rsa.privateKey });
  const cases = [
    ["bad_nonce", good({ nonce: "other" })],
    ["bad_nonce", good({ nonce: undefined })],
    ["bad_audience", good({ aud: "someone-else" })],
    ["bad_issuer", good({ iss: "https://evil.test" })],
    ["expired", good({ exp: NOW - 600 })],
    ["missing_subject", good({ sub: "" })],
    ["missing_iat", good({ iat: undefined })],
    ["not_yet_valid", good({ nbf: NOW + 3600 })],
    ["unknown_kid", good({}, { alg: "RS256", kid: "nope" })],
    [
      "alg_not_allowed",
      signJwt({
        header: { alg: "none", kid: "k1" },
        payload: baseClaims(),
        key: rsa.privateKey,
      }).replace(/\.[^.]*$/, "."),
    ],
    ["alg_not_allowed", good({}, { alg: "HS256", kid: "k1" })],
  ];
  for (const [reason, token] of cases) {
    const { verdict } = await validate(t, { token });
    assert.equal(verdict.ok, false, reason);
    assert.equal(verdict.reason, reason);
  }
  // Tampered payload with the original signature.
  const original = good();
  const [h, , s] = original.split(".");
  const forged = `${h}.${b64(baseClaims({ sub: "attacker" }))}.${s}`;
  assert.equal(
    (await validate(t, { token: forged })).verdict.reason,
    "bad_signature",
  );
  // Signed by a different key with the same kid.
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongKey = signJwt({
    header: { alg: "RS256", kid: "k1" },
    payload: baseClaims(),
    key: other.privateKey,
  });
  assert.equal(
    (await validate(t, { token: wrongKey })).verdict.reason,
    "bad_signature",
  );
  // Not a JWT at all.
  assert.equal(
    (await validate(t, { token: "not-a-jwt" })).verdict.reason,
    "not_a_jwt",
  );
});

test("ID token: an unknown kid refetches the JWKS once, then fails", async (t) => {
  const token = signJwt({
    header: { alg: "RS256", kid: "rotated" },
    payload: baseClaims(),
    key: rsa.privateKey,
  });
  const { verdict, forced } = await validate(t, { token });
  assert.equal(verdict.reason, "unknown_kid");
  assert.equal(forced, 1);
});

test("HTTP client only contacts allow-listed origins and never calls fetch otherwise", async () => {
  let calls = 0;
  const client = createHttp({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  await assert.rejects(client.text("https://example.com/x"), /blocked origin/);
  await assert.rejects(client.text("http://127.0.0.1:9/x"), /blocked origin/);
  await assert.rejects(
    client.stream("https://evil.test/v1/responses", {}, () => {}),
    /blocked origin/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    [...DEFAULT_ENDPOINTS.allowedOrigins],
    [AUTH_ORIGIN, API_ORIGIN],
  );
  assert.equal(AUTH_ORIGIN, "https://auth.openai.com");
  assert.equal(API_ORIGIN, "https://api.openai.com");
});

test("HTTP client refuses redirects and oversized bodies", async () => {
  let init;
  const client = createHttp({
    allowedOrigins: ["http://127.0.0.1:1"],
    maxBodyBytes: 16,
    fetchImpl: async (_url, options) => {
      init = options;
      return new Response("x".repeat(64));
    },
  });
  await assert.rejects(client.text("http://127.0.0.1:1/a"), /body too large/);
  assert.equal(init.redirect, "error");
});

test("SSE parser splits events across chunks and ignores non-JSON data", () => {
  const first = drainSse(
    'event: a\ndata: {"type":"response.created"}\n\nevent: b\ndata: {"type":"resp',
  );
  assert.deepEqual(
    first.events.map((e) => e.type),
    ["response.created"],
  );
  const second = drainSse(
    `${first.rest}onse.completed"}\r\n\r\ndata: [DONE]\n\n`,
  );
  assert.deepEqual(
    second.events.map((e) => e.type),
    ["response.completed"],
  );
});

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

test("prohibited field list matches the preview-limitations page", () => {
  assert.deepEqual(
    [...PROHIBITED_FIELDS].sort(),
    [
      "background",
      "conversation",
      "max_output_tokens",
      "max_tool_calls",
      "metadata",
      "moderation",
      "multi_agent",
      "previous_response_id",
      "prompt",
      "prompt_cache_retention",
      "safety_identifier",
      "temperature",
      "top_logprobs",
      "top_p",
      "truncation",
      "user",
    ].sort(),
  );
});

test("probe bodies set store false, stream true, use instructions and no prohibited field", () => {
  const call = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "get_time",
    arguments: "{}",
    status: "completed",
  };
  const bodies = [
    buildTextBody("m"),
    ...TOOL_VARIANTS.flatMap((variant) => [
      buildToolBody("m", variant),
      buildReplayBody("m", variant, call),
      buildReplayBody("m", variant, call, { minimal: true }),
    ]),
  ];
  for (const body of bodies) {
    assertSupportedBody(body);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(typeof body.instructions, "string");
    for (const field of PROHIBITED_FIELDS)
      assert.equal(field in body, false, field);
    assert.equal(JSON.stringify(body).includes('"role":"system"'), false);
  }
});

test("each prohibited field and a system item are rejected before sending", () => {
  for (const field of PROHIBITED_FIELDS) {
    assert.throws(
      () => assertSupportedBody({ ...buildTextBody("m"), [field]: 1 }),
      /prohibited/,
    );
  }
  assert.throws(
    () =>
      assertSupportedBody({
        ...buildTextBody("m"),
        input: [{ role: "system", content: "x" }],
      }),
    /system/,
  );
  assert.throws(
    () => assertSupportedBody({ ...buildTextBody("m"), store: true }),
    /store/,
  );
});

test("tool variants use the three documented shapes", () => {
  const [top, namespace, additional] = TOOL_VARIANTS.map((variant) =>
    buildToolBody("m", variant),
  );
  assert.equal(top.tools[0].type, "function");
  assert.equal(top.tools[0].name, "get_time");
  assert.equal(namespace.tools[0].type, "namespace");
  assert.equal(namespace.tools[0].name, "colony");
  assert.equal(namespace.tools[0].tools[0].type, "function");
  assert.equal("tools" in additional, false);
  assert.equal(additional.input[0].type, "additional_tools");
  assert.equal(additional.input[0].role, "developer");
  assert.equal(additional.input[0].tools[0].name, "get_time");
});

test("replay body returns a function_call_output and echoes the namespace", () => {
  const call = {
    type: "function_call",
    id: "fc_9",
    call_id: "call_9",
    name: "get_time",
    namespace: "colony",
    arguments: "{}",
    status: "completed",
  };
  const body = buildReplayBody("m", TOOL_VARIANTS[1], call);
  const items = body.input;
  assert.deepEqual(items[1], call);
  assert.equal(items[2].type, "function_call_output");
  assert.equal(items[2].call_id, "call_9");
  assert.equal(items[2].namespace, "colony");
  const minimal = buildReplayBody("m", TOOL_VARIANTS[1], call, {
    minimal: true,
  }).input[1];
  assert.deepEqual(Object.keys(minimal).sort(), [
    "arguments",
    "call_id",
    "name",
    "namespace",
    "type",
  ]);
});

// ---------------------------------------------------------------------------
// Redaction: the report never carries token-shaped strings
// ---------------------------------------------------------------------------

function tokenLike() {
  const length = 40 + Math.floor(Math.random() * 80);
  const b = () => randomBytes(length).toString("base64url").slice(0, length);
  const kinds = [
    b,
    () => randomBytes(length).toString("hex").slice(0, length),
    () =>
      `eyJ${randomBytes(20).toString("base64url")}.${randomBytes(60).toString("base64url")}.${randomBytes(40).toString("base64url")}`,
    () => `rt_${b()}`,
    () => `Bearer ${b()}`,
    () => `sk-${b()}`,
  ];
  return kinds[Math.floor(Math.random() * kinds.length)]();
}

function windows(token, size = 24) {
  const parts = [];
  const core = token.replace(/^Bearer /, "");
  for (let i = 0; i + size <= core.length; i += 7)
    parts.push(core.slice(i, i + size));
  return parts;
}

function assertNoLeak(output, token) {
  for (const part of windows(token)) {
    assert.equal(
      output.includes(part),
      false,
      `leaked a piece of a token-shaped string: ${part.slice(0, 6)}...`,
    );
  }
}

test("redaction property: token-shaped input never reaches any report field", () => {
  const registry = new SecretRegistry();
  for (let i = 0; i < 300; i += 1) {
    const token = tokenLike();
    const row = makeRow(
      {
        id: token,
        title: token,
        outcome: "pass",
        http: 200,
        code: token,
        param: token,
        completed: true,
        ms: 5,
        note: `note ${token} end`,
      },
      registry,
    );
    const described = describeInference(
      {
        status: 400,
        streamed: false,
        error: { code: token, param: token, detail: token },
        summary: newStreamSummary(),
        ms: 3,
      },
      {},
    );
    const row2 = makeRow({ id: "X1", title: "t", ...described }, registry);
    const text = renderReport(
      {
        rows: [row, row2],
        facts: [[token, token]],
        reading: [`reading ${token}`],
      },
      registry,
    );
    assertNoLeak(text, token);
    assertNoLeak(sanitizeText(token, registry), token);
    assertNoLeak(sanitizeText(`prefix ${token} suffix`), token);
  }
});

test("redaction: registered secrets are scrubbed even when short and unshaped", () => {
  const registry = new SecretRegistry();
  const jwt = `${b64({ alg: "RS256" })}.${b64({ sub: "abc" })}.${randomBytes(30).toString("base64url")}`;
  for (const secret of [
    "tiny-secret",
    "a.b.c.d-e-f-g-h",
    jwt,
    "state-1234",
    "code_9876",
  ])
    registry.add(secret);
  const text = renderReport(
    {
      rows: [
        makeRow(
          {
            id: "S1",
            title: "tiny-secret",
            outcome: "fail",
            note: `got state-1234 and ${jwt} and code_9876`,
          },
          registry,
        ),
      ],
      facts: [["f", "tiny-secret"]],
      reading: ["code_9876 here"],
    },
    registry,
  );
  for (const secret of [
    "tiny-secret",
    "state-1234",
    "code_9876",
    jwt,
    ...jwt.split("."),
  ]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("redaction keeps readable codes, slugs and numbers", () => {
  const registry = new SecretRegistry();
  const row = makeRow(
    {
      id: "P3",
      title: "Tool call: namespace",
      outcome: "fail",
      http: 400,
      code: "subscription_sharing_unsupported_capability",
      param: "tools[0].type",
      completed: false,
      ms: 812,
      note: "slugs: gpt-6.1-sol, gpt-6.1-luna; events: response.created,response.failed",
    },
    registry,
  );
  assert.equal(row.code, "subscription_sharing_unsupported_capability");
  assert.equal(row.param, "tools[0].type");
  assert.equal(row.http, "400");
  assert.equal(row.completed, "no");
  assert.match(row.note, /gpt-6\.1-sol/);
  assert.match(row.note, /response\.failed/);
});

test("report text has no em dash and the em dash is never needed", () => {
  const registry = new SecretRegistry();
  const text = renderReport(
    {
      rows: [makeRow({ id: "S1", title: "x", outcome: "pass" }, registry)],
      facts: [["k", "v"]],
      reading: ["r"],
    },
    registry,
  );
  assert.equal(text.includes(EM_DASH), false);
});

// ---------------------------------------------------------------------------
// Owner guard, cleanup, files
// ---------------------------------------------------------------------------

test("guard refuses without the owner variable, without a TTY, and in CI", () => {
  assert.equal(checkOwnerRun({ env: {}, stdin: { isTTY: true } }).ok, false);
  assert.equal(
    checkOwnerRun({
      env: { SIWC_PROBE_I_AM_THE_OWNER: "0" },
      stdin: { isTTY: true },
    }).ok,
    false,
  );
  assert.equal(
    checkOwnerRun({
      env: { SIWC_PROBE_I_AM_THE_OWNER: "1" },
      stdin: { isTTY: false },
    }).ok,
    false,
  );
  assert.equal(
    checkOwnerRun({ env: { SIWC_PROBE_I_AM_THE_OWNER: "1" }, stdin: undefined })
      .ok,
    false,
  );
  assert.equal(
    checkOwnerRun({
      env: { SIWC_PROBE_I_AM_THE_OWNER: "1", CI: "true" },
      stdin: { isTTY: true },
    }).ok,
    false,
  );
  assert.equal(
    checkOwnerRun({
      env: { SIWC_PROBE_I_AM_THE_OWNER: "1" },
      stdin: { isTTY: true },
    }).ok,
    true,
  );
});

test("the real script exits 2 without the owner variable and without a TTY", () => {
  const base = { ...process.env };
  delete base.SIWC_PROBE_I_AM_THE_OWNER;
  const noOwner = spawnSync(process.execPath, [SCRIPT], {
    env: base,
    input: "",
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(noOwner.status, 2);
  assert.match(noOwner.stderr, /SIWC_PROBE_I_AM_THE_OWNER=1/);
  const noTty = spawnSync(process.execPath, [SCRIPT], {
    env: { ...base, SIWC_PROBE_I_AM_THE_OWNER: "1" },
    input: "",
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(noTty.status, 2);
  assert.match(noTty.stderr, /not a terminal/);
});

test("scratch directory is created private and removed after success", async (t) => {
  const parent = tempParent(t);
  let dir;
  await withScratch(
    async (scratch) => {
      dir = scratch.dir;
      assert.ok(existsSync(dir));
      if (!isWindows)
        assert.equal((statSync(dir).mode & 0o777).toString(8), "700");
      writePrivateFileAtomic(path.join(dir, "credentials.json"), "{}");
    },
    { parent, proc: new EventEmitter(), exit: () => {} },
  );
  assert.equal(existsSync(dir), false);
});

test("scratch directory is removed when the work throws", async (t) => {
  const parent = tempParent(t);
  let dir;
  await assert.rejects(
    withScratch(
      async (scratch) => {
        dir = scratch.dir;
        writePrivateFileAtomic(
          path.join(dir, "credentials.json"),
          '{"refresh_token":"x"}',
        );
        throw new Error("boom");
      },
      { parent, proc: new EventEmitter(), exit: () => {} },
    ),
    /boom/,
  );
  assert.equal(existsSync(dir), false);
  assert.deepEqual(readdirSync(parent), []);
});

test("signal handlers remove the scratch directory and exit with the signal code", async (t) => {
  const parent = tempParent(t);
  const proc = new EventEmitter();
  const exits = [];
  const scratch = createScratch({ parent });
  const uninstall = installCleanupHandlers(scratch, {
    proc,
    exit: (code) => exits.push(code),
  });
  writePrivateFileAtomic(path.join(scratch.dir, "credentials.json"), "{}");
  proc.emit("SIGINT");
  assert.equal(existsSync(scratch.dir), false);
  assert.deepEqual(exits, [130]);
  uninstall();
  assert.equal(proc.listenerCount("SIGINT"), 0);
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`a real ${signal} to a running probe process deletes the scratch directory`, async (t) => {
    const parent = tempParent(t);
    const script = `
      import { writeFileSync } from "node:fs";
      import path from "node:path";
      const { withScratch, writePrivateFileAtomic } = await import(process.env.PROBE_URL);
      await withScratch(async (scratch) => {
        writePrivateFileAtomic(path.join(scratch.dir, "credentials.json"), '{"refresh_token":"secret"}');
        console.log("READY " + scratch.dir);
        setInterval(() => {}, 1000);
        await new Promise(() => {});
      }, { parent: process.env.PROBE_PARENT });
    `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        env: {
          ...process.env,
          PROBE_URL: pathToFileURL(SCRIPT).href,
          PROBE_PARENT: parent,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => child.kill("SIGKILL"));
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const dir = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(
        () => reject(new Error(`child never became ready: ${stderr}`)),
        15_000,
      );
      child.stdout.on("data", (chunk) => {
        out += chunk;
        const match = out.match(/READY (.+)\n/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("exit", () =>
        reject(new Error(`child exited early: ${stderr}`)),
      );
    });
    assert.ok(existsSync(path.join(dir, "credentials.json")));
    const exited = new Promise((resolve) =>
      child.once("exit", (status, sig) => resolve({ status, sig })),
    );
    child.kill(signal);
    const { status } = await exited;
    assert.equal(
      existsSync(dir),
      false,
      "scratch directory must be gone after the signal",
    );
    if (!isWindows) assert.equal(status, code);
  });
}

test("private file write is atomic, 0600, and leaves no temp files", (t) => {
  const parent = tempParent(t);
  const file = path.join(parent, "credentials.json");
  writePrivateFileAtomic(file, "first");
  writePrivateFileAtomic(file, "second");
  assert.deepEqual(readdirSync(parent), ["credentials.json"]);
  if (!isWindows)
    assert.equal((statSync(file).mode & 0o777).toString(8), "600");
});

test("host id is a persisted urn:uuid, reused across runs, regenerated if damaged", (t) => {
  const home = path.join(tempParent(t), "home");
  const first = loadOrCreateHostId(home);
  assert.equal(first.created, true);
  assert.match(first.id, /^urn:uuid:[0-9a-f-]{36}$/);
  const second = loadOrCreateHostId(home);
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  writeFileSync(
    path.join(home, "host-id.json"),
    '{"ext_agent_host_id":"someone@example.test"}',
  );
  const third = loadOrCreateHostId(home);
  assert.equal(third.created, true);
  assert.notEqual(third.id, first.id);
  if (!isWindows)
    assert.equal((statSync(home).mode & 0o777).toString(8), "700");
});

test("stale scratch sweep removes only old directories with the probe prefix", (t) => {
  const parent = tempParent(t);
  const old = path.join(parent, "siwc-probe-old");
  const fresh = path.join(parent, "siwc-probe-fresh");
  const other = path.join(parent, "unrelated-old");
  for (const dir of [old, fresh, other]) mkdirSync(dir);
  const longAgo = new Date(Date.now() - 3 * 3_600_000);
  utimesSync(old, longAgo, longAgo);
  utimesSync(other, longAgo, longAgo);
  assert.equal(sweepStaleScratch({ parent }), 1);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(other), true);
});

// ---------------------------------------------------------------------------
// End to end against a local fake of auth.openai.com and api.openai.com
// ---------------------------------------------------------------------------

const FAKE_SCOPE =
  "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";
const FAKE_EMAIL = "owner@fake.example";
const FAKE_SUB = "fake-subject-123";

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

async function startFake(options = {}) {
  const {
    tools = "all", // "all" | "namespace-only" | "none"
    limitAfterFirst = false,
    firstAuthorize = "ok", // "ok" | "error" | "denied"
    noPlanScope = false,
    wrongNonce = false,
    discoveryIssuer = null,
  } = options;
  const log = {
    authorize: [],
    token: [],
    responses: [],
    revoke: [],
    models: [],
  };
  const issued = new Set();
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Set();
  let authorizeCalls = 0;
  let refreshCounter = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };
    const bearerOk = () =>
      accessTokens.has(
        (req.headers.authorization ?? "").replace(/^Bearer /, ""),
      );
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer: discoveryIssuer ?? origin,
        authorization_endpoint: `${origin}/api/accounts/authorize`,
        token_endpoint: `${origin}/api/accounts/oauth/token`,
        jwks_uri: `${origin}/.well-known/jwks.json`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url.pathname === "/.well-known/jwks.json")
      return send(200, { keys: [rsaJwk] });
    if (url.pathname === "/api/accounts/authorize") {
      authorizeCalls += 1;
      const params = Object.fromEntries(url.searchParams);
      log.authorize.push(params);
      const redirect = new URL(params.redirect_uri);
      const mode = authorizeCalls === 1 ? firstAuthorize : "ok";
      if (mode === "error")
        redirect.searchParams.set("error", "invalid_request");
      else if (mode === "denied")
        redirect.searchParams.set("error", "access_denied");
      else {
        const code = `code_${randomBytes(18).toString("base64url")}`;
        codes.set(code, { params, clientId: `oaiapp_fake_${authorizeCalls}` });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("client_id", `oaiapp_fake_${authorizeCalls}`);
        redirect.searchParams.set(
          "scope",
          noPlanScope ? "email openid profile offline_access" : FAKE_SCOPE,
        );
      }
      redirect.searchParams.set("state", params.state);
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (url.pathname === "/api/accounts/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      log.token.push(form);
      const mint = (clientId, nonce) => {
        const access = signJwt({
          header: { alg: "RS256", kid: "k1" },
          payload: {
            sub: FAKE_SUB,
            aud: `${origin}/v1`,
            client_id: clientId,
            scope: FAKE_SCOPE,
            iss: origin,
            exp: NOW + 3600,
            jti: randomBytes(8).toString("hex"),
          },
          key: rsa.privateKey,
        });
        refreshCounter += 1;
        const refresh = `rt_${refreshCounter}_${randomBytes(30).toString("base64url")}`;
        const id = signJwt({
          header: { alg: "RS256", kid: "k1" },
          payload: {
            iss: origin,
            aud: clientId,
            sub: FAKE_SUB,
            email: FAKE_EMAIL,
            nonce: wrongNonce ? "wrong" : nonce,
            iat: Math.floor(Date.now() / 1000) - 5,
            exp: Math.floor(Date.now() / 1000) + 3600,
            "https://api.openai.com/auth": {
              chatgpt_plan_type: "plus",
              user_id: "user-secret-id",
            },
          },
          key: rsa.privateKey,
        });
        accessTokens.add(access);
        refreshTokens.set(refresh, { clientId, nonce });
        for (const value of [access, refresh, id]) issued.add(value);
        return {
          access_token: access,
          refresh_token: refresh,
          id_token: id,
          token_type: "Bearer",
          expires_in: 3600,
          scope: noPlanScope
            ? "email openid profile offline_access"
            : FAKE_SCOPE,
          earliest_refresh_at: Math.floor(Date.now() / 1000) - 1,
        };
      };
      if (form.grant_type === "authorization_code") {
        const entry = codes.get(form.code);
        const challenge =
          entry &&
          createHash("sha256")
            .update(form.code_verifier ?? "")
            .digest("base64url");
        if (
          !entry ||
          challenge !== entry.params.code_challenge ||
          form.redirect_uri !== entry.params.redirect_uri ||
          form.client_id !== entry.clientId ||
          form.resource !== `${origin}/v1`
        ) {
          return send(400, { error: "invalid_grant" });
        }
        codes.delete(form.code);
        return send(200, mint(entry.clientId, entry.params.nonce));
      }
      if (form.grant_type === "refresh_token") {
        const entry = refreshTokens.get(form.refresh_token);
        if (!entry || form.client_id !== entry.clientId)
          return send(400, { error: "invalid_grant" });
        refreshTokens.delete(form.refresh_token);
        return send(200, mint(entry.clientId, entry.nonce));
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/oauth/revoke") {
      log.revoke.push(
        Object.fromEntries(new URLSearchParams(await readBody(req))),
      );
      res.writeHead(200);
      return res.end();
    }
    if (url.pathname === "/v1/models") {
      log.models.push(req.headers.authorization);
      if (!bearerOk()) return send(401, { detail: "Unauthorized" });
      return send(200, {
        models: [
          { slug: "gpt-fake-1", display_name: "Fake One", visibility: "list" },
          { slug: "hidden-fake", display_name: "Hidden", visibility: "hide" },
          { slug: "gpt-fake-2", display_name: "Fake Two", visibility: "list" },
        ],
      });
    }
    if (url.pathname === "/v1/responses") {
      const body = JSON.parse(await readBody(req));
      log.responses.push(body);
      if (!bearerOk()) return send(401, { detail: "Unauthorized" });
      for (const field of PROHIBITED_FIELDS) {
        if (field in body)
          return send(400, {
            error: {
              code: "subscription_sharing_unsupported_capability",
              param: field,
              message: "unsupported",
            },
          });
      }
      const unsupported = (param) =>
        send(400, {
          error: {
            code: "subscription_sharing_unsupported_capability",
            param,
            message: "unsupported tool",
          },
        });
      const first = body.tools?.[0];
      const prefixItem = body.input?.[0]?.type === "additional_tools";
      if (first?.type === "function" && tools !== "all")
        return unsupported("tools[0].type");
      if (first?.type === "namespace" && tools === "none")
        return unsupported("tools[0].type");
      if (prefixItem && tools !== "all") return unsupported("input[0].type");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type, data) =>
        res.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
        );
      event("response.created", { response: { id: "resp_1" } });
      if (limitAfterFirst && log.responses.length > 1) {
        event("response.output_text.delta", { delta: "Hel" });
        event("response.output_text.delta", { delta: "lo" });
        event("response.failed", {
          response: {
            error: {
              code: "subscription_sharing_usage_limit_exceeded",
              message: "limit",
            },
          },
        });
        return res.end();
      }
      const hasTools = Boolean(first) || prefixItem;
      const output = body.input.find(
        (item) => item.type === "function_call_output",
      );
      if (hasTools && !output) {
        const namespace = first?.type === "namespace" ? first.name : undefined;
        const item = {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "get_time",
          ...(namespace ? { namespace } : {}),
          arguments: "{}",
          status: "completed",
        };
        event("response.output_item.done", { item });
        event("response.completed", {
          response: {
            output: [item],
            usage: { input_tokens: 40, output_tokens: 8 },
          },
        });
        return res.end();
      }
      if (output) {
        const call = body.input.find(
          (item) =>
            item.type === "function_call" && item.call_id === output.call_id,
        );
        if (!call) {
          res.write(
            `event: error\ndata: ${JSON.stringify({ type: "error", code: "invalid_request", param: "input" })}\n\n`,
          );
          return res.end();
        }
      }
      event("response.output_text.delta", { delta: "Hello, " });
      event("response.output_text.delta", { delta: "world!" });
      event("response.completed", {
        response: { usage: { input_tokens: 20, output_tokens: 4 } },
      });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const endpoints = {
    issuer: origin,
    authorizeUrl: `${origin}/api/accounts/authorize`,
    tokenUrl: `${origin}/api/accounts/oauth/token`,
    discoveryUrl: `${origin}/.well-known/openid-configuration`,
    apiBase: `${origin}/v1`,
    resource: `${origin}/v1`,
    allowedOrigins: [origin],
  };
  return { origin, endpoints, log, issued, close: () => server.close() };
}

/** A stand-in browser: follows the authorize redirect to the loopback callback. */
function browserFor() {
  return async (url) => {
    setImmediate(async () => {
      const first = await fetch(url, { redirect: "manual" });
      const location = first.headers.get("location");
      if (location) await fetch(location);
    });
    return true;
  };
}

async function runAgainstFake(t, options = {}, deps = {}) {
  const fake = await startFake(options);
  t.after(() => fake.close());
  const parent = tempParent(t);
  const registry = new SecretRegistry();
  let scratchDir;
  const report = await withScratch(
    async (scratch) => {
      scratchDir = scratch.dir;
      return runProbe({
        endpoints: fake.endpoints,
        client: createHttp({ allowedOrigins: [fake.origin] }),
        registry,
        scratch,
        hostId: "urn:uuid:3f0f4c0e-6a5c-4a43-9c3a-0d4f4d6a7b11",
        openBrowser: browserFor(),
        listenerTimeoutMs: 5000,
        ports: [0, 0],
        ...deps,
      });
    },
    { parent, proc: new EventEmitter(), exit: () => {} },
  );
  const text = renderReport(report, registry);
  const rows = new Map(report.rows.map((row) => [row.id, row]));
  return { fake, report, rows, text, scratchDir };
}

function assertReportIsClean(result) {
  for (const secret of result.fake.issued) {
    assert.equal(
      result.text.includes(secret),
      false,
      "a token appeared in the report",
    );
    for (const part of secret.split("."))
      assert.equal(result.text.includes(part), false);
  }
  for (const value of [FAKE_EMAIL, FAKE_SUB, "user-secret-id"]) {
    assert.equal(
      result.text.includes(value),
      false,
      `${value} appeared in the report`,
    );
  }
  assert.doesNotMatch(result.text, /eyJ[A-Za-z0-9_-]{4,}\./);
  assert.equal(result.text.includes(EM_DASH), false);
}

test("end to end: the whole probe passes against a fake issuer that accepts every tool shape", async (t) => {
  const result = await runAgainstFake(t);
  const { rows, fake, report } = result;
  for (const id of [
    "D1",
    "S1",
    "S2",
    "S3",
    "F1",
    "M1",
    "P1",
    "P2",
    "P3",
    "P4",
    "P2r",
    "P3r",
    "P4r",
    "P6",
    "T1",
    "T2",
    "V1",
  ]) {
    assert.equal(
      rows.get(id)?.outcome,
      "pass",
      `${id}: ${JSON.stringify(rows.get(id))}`,
    );
  }
  assert.equal(rows.get("S1").note.startsWith("port "), true);
  assert.match(rows.get("M1").note, /gpt-fake-1, gpt-fake-2/);
  assert.doesNotMatch(rows.get("M1").note, /hidden-fake/);
  assert.match(rows.get("S3").note, /email claim present: yes/);
  assert.match(rows.get("S3").note, /auth\.chatgpt_plan_type/);
  assert.match(rows.get("T1").note, /refresh token rotated: yes/);
  assert.equal(rows.get("R1").http, "400");
  assert.equal(
    rows.get("R1").code,
    "subscription_sharing_unsupported_capability",
  );
  assert.equal(rows.get("R1").param, "max_output_tokens");
  assert.equal(rows.get("P3").completed, "yes");
  assert.match(rows.get("P3").note, /namespace echoed: colony/);
  assert.deepEqual(
    report.facts.find(([key]) => key === "plan name exposed"),
    ["plan name exposed", "plus"],
  );
  assert.match(deriveReading(report.rows).join("\n"), /Route A is viable/);
  assert.equal(
    existsSync(result.scratchDir),
    false,
    "scratch directory is deleted",
  );
  assertReportIsClean(result);

  // Budget: tiny and counted.
  assert.ok(
    fake.log.responses.length <= MAX_INFERENCE_REQUESTS,
    String(fake.log.responses.length),
  );
  assert.equal(fake.log.responses.length, 10);
  for (const body of fake.log.responses.filter(
    (b) => !("max_output_tokens" in b),
  )) {
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(typeof body.instructions, "string");
  }

  // The sign-in request was exactly the documented one.
  assert.equal(fake.log.authorize.length, 1);
  const auth = fake.log.authorize[0];
  assert.deepEqual(Object.keys(auth).sort(), [
    "agent_name_hint",
    "client_id",
    "code_challenge",
    "code_challenge_method",
    "ext_agent_host_id",
    "nonce",
    "redirect_uri",
    "resource",
    "response_type",
    "scope",
    "state",
  ]);
  assert.equal(auth.client_id, "dynamic_agent_client");
  assert.equal(auth.scope, SCOPE);
  const redirect = new URL(auth.redirect_uri);
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/auth/callback");

  // Code exchange and refresh used the issued client id, form fields only, no secret, no scope on refresh.
  const [exchange, refresh] = fake.log.token;
  assert.equal(exchange.grant_type, "authorization_code");
  assert.equal(exchange.client_id, "oaiapp_fake_1");
  assert.equal(exchange.resource, `${fake.origin}/v1`);
  assert.equal("client_secret" in exchange, false);
  assert.equal(refresh.grant_type, "refresh_token");
  assert.equal(refresh.client_id, "oaiapp_fake_1");
  assert.equal("scope" in refresh, false);
  assert.equal(fake.log.revoke.length, 1);
  assert.equal(fake.log.revoke[0].token_type_hint, "refresh_token");

  // Replay shapes: as returned for the namespace variant, with the namespace echoed.
  const replay = fake.log.responses.find(
    (b) =>
      b.input.some((i) => i.type === "function_call_output") &&
      b.tools?.[0]?.type === "namespace",
  );
  assert.equal(
    replay.input.find((i) => i.type === "function_call").namespace,
    "colony",
  );
  assert.equal(
    replay.input.find((i) => i.type === "function_call_output").namespace,
    "colony",
  );
});

test("end to end: plain top-level tools refused, namespace accepted: ladder step one", async (t) => {
  const result = await runAgainstFake(t, { tools: "namespace-only" });
  const { rows } = result;
  assert.equal(rows.get("P2").outcome, "fail");
  assert.equal(rows.get("P2").http, "400");
  assert.equal(
    rows.get("P2").code,
    "subscription_sharing_unsupported_capability",
  );
  assert.equal(rows.get("P2").param, "tools[0].type");
  assert.equal(rows.get("P2").completed, "no");
  assert.equal(rows.get("P3").outcome, "pass");
  assert.equal(rows.get("P4").outcome, "fail");
  assert.equal(rows.get("P4").param, "input[0].type");
  assert.equal(rows.get("P3r").outcome, "pass");
  assert.equal(rows.has("P2r"), false);
  const reading = deriveReading(result.report.rows).join("\n");
  assert.match(reading, /Tool call returned via: namespace\./);
  assert.match(reading, /round trip finished via: namespace/);
  assertReportIsClean(result);
});

test("end to end: every tool shape refused points at route B", async (t) => {
  const result = await runAgainstFake(t, { tools: "none" });
  for (const id of ["P2", "P3", "P4"])
    assert.equal(result.rows.get(id).outcome, "fail", id);
  assert.equal(result.rows.has("P3r"), false);
  assert.match(deriveReading(result.report.rows).join("\n"), /Route B/);
  assertReportIsClean(result);
});

test("end to end: a usage limit after streaming began stops further requests and is recorded", async (t) => {
  const result = await runAgainstFake(t, { limitAfterFirst: true });
  const { rows, fake } = result;
  assert.equal(rows.get("P1").outcome, "pass");
  assert.equal(rows.get("P2").outcome, "fail");
  assert.equal(
    rows.get("P2").code,
    "subscription_sharing_usage_limit_exceeded",
  );
  assert.equal(rows.get("P2").completed, "no");
  assert.equal(rows.has("P3"), false);
  assert.equal(rows.get("R2").outcome, "info");
  assert.equal(fake.log.responses.length, 2);
  // Refresh and revoke still run so nothing stays valid.
  assert.equal(rows.get("T1").outcome, "pass");
  assert.equal(rows.get("V1").outcome, "pass");
});

test("end to end: the inference budget is a hard cap", async (t) => {
  const result = await runAgainstFake(t, {}, { maxInference: 3 });
  assert.equal(result.fake.log.responses.length, 3);
  assert.equal(result.rows.get("P4")?.outcome, "skip");
  assert.match(result.rows.get("P4").note, /budget/);
});

test("end to end: if the plan scope is not granted, no inference request is sent", async (t) => {
  const result = await runAgainstFake(t, { noPlanScope: true });
  assert.equal(result.rows.get("S2").outcome, "fail");
  assert.equal(result.rows.get("S2").code, "plan_scope_missing");
  assert.equal(result.rows.get("M1").outcome, "skip");
  assert.equal(result.fake.log.responses.length, 0);
});

test("end to end: a bad ID token nonce is reported and the probe still maps the API", async (t) => {
  const result = await runAgainstFake(t, { wrongNonce: true });
  assert.equal(result.rows.get("S3").outcome, "fail");
  assert.equal(result.rows.get("S3").code, "bad_nonce");
  assert.match(result.rows.get("S3").note, /continuing/);
  assert.equal(result.rows.get("P1").outcome, "pass");
  assertReportIsClean(result);
});

test("end to end: a refused first sign-in retries and the second attempt completes", async (t) => {
  const result = await runAgainstFake(t, { firstAuthorize: "error" });
  assert.equal(result.rows.get("S1").outcome, "fail");
  assert.equal(result.rows.get("S1").code, "invalid_request");
  assert.equal(result.rows.get("S1b").outcome, "pass");
  assert.equal(result.rows.get("S2").outcome, "pass");
  assert.equal(result.fake.log.authorize.length, 2);
  // Every attempt gets fresh state, nonce and challenge.
  const [a, b] = result.fake.log.authorize;
  for (const key of ["state", "nonce", "code_challenge"])
    assert.notEqual(a[key], b[key], key);
});

test("end to end: pressing Enter abandons the first attempt and retries", async (t) => {
  let calls = 0;
  const enterSignal = () => {
    calls += 1;
    return {
      promise: calls === 1 ? Promise.resolve() : new Promise(() => {}),
      cancel() {},
    };
  };
  let opened = 0;
  const base = browserFor();
  const openBrowser = async (url) => {
    opened += 1;
    return opened === 1 ? true : base(url);
  };
  const result = await runAgainstFake(t, {}, { enterSignal, openBrowser });
  assert.equal(result.rows.get("S1").code, "owner_retry");
  assert.equal(result.rows.get("S1b").outcome, "pass");
});

test("end to end: access_denied stops without exchanging a code", async (t) => {
  const result = await runAgainstFake(t, { firstAuthorize: "denied" });
  assert.equal(result.rows.get("S1").code, "access_denied");
  assert.equal(result.rows.has("S1b"), false);
  assert.equal(result.fake.log.token.length, 0);
  assert.ok(result.report.facts.some(([key]) => key === "stopped early"));
});

test("reading: a failed sign-in or failed P1 stops the decision", () => {
  const registry = new SecretRegistry();
  const row = (id, outcome) => makeRow({ id, title: id, outcome }, registry);
  assert.match(
    deriveReading([row("S1", "fail")]).join(" "),
    /Sign-in did not complete/,
  );
  assert.match(
    deriveReading([row("S1", "pass"), row("P1", "fail")]).join(" "),
    /ask OpenAI/,
  );
});

test("describeInference: a stream that ends without response.completed is a failure", () => {
  const summary = newStreamSummary();
  applyEvent(summary, "response.created", {});
  applyEvent(summary, "response.output_text.delta", { delta: "Hi" });
  const described = describeInference({
    status: 200,
    streamed: true,
    summary,
    ms: 4,
  });
  assert.equal(described.outcome, "fail");
  assert.equal(described.completed, false);
  applyEvent(summary, "response.completed", {});
  assert.equal(
    describeInference({ status: 200, streamed: true, summary, ms: 4 }).outcome,
    "pass",
  );
});

test("end to end: a discovery issuer mismatch is recorded and the probe carries on", async (t) => {
  const result = await runAgainstFake(t, {
    discoveryIssuer: "https://other.example",
  });
  assert.equal(result.rows.get("D1").outcome, "fail");
  assert.equal(result.rows.get("D1").code, "bad_issuer");
  assert.match(
    result.rows.get("D1").note,
    /observed issuer: https:\/\/other\.example/,
  );
  assert.equal(result.rows.get("S2").outcome, "pass");
  assert.equal(result.rows.get("P1").outcome, "pass");
  assertReportIsClean(result);
});

test("describeInference: a non-JSON error body is noted, not echoed", () => {
  const described = describeInference({
    status: 403,
    streamed: false,
    jsonBody: false,
    bodyLength: 512,
    error: { code: null, param: null, detail: null },
    summary: newStreamSummary(),
    ms: 9,
  });
  assert.equal(described.outcome, "fail");
  assert.equal(described.http, 403);
  assert.match(described.note, /non-JSON body, 512 chars/);
});

test("describeInference: HTTP 200 without an event stream is a failure with a note", () => {
  const described = describeInference({
    status: 200,
    streamed: false,
    jsonBody: true,
    bodyLength: 2,
    error: { code: null, param: null, detail: null },
    summary: newStreamSummary(),
    ms: 4,
  });
  assert.equal(described.outcome, "fail");
  assert.match(described.note, /not an event stream/);
});
