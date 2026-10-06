#!/usr/bin/env node
// ChatGPT plan probe (slice S0 of the ChatGPT plan sign-in design).
//
// The OWNER runs this once, on their own Mac, with their own ChatGPT Plus or
// Pro account. It answers the questions the Rust design depends on and prints
// one table to paste back:
//
//   1. Can the loopback sign-in finish with dynamic registration?
//   2. Does GET /v1/models list models, and which slugs?
//   3. Does POST /v1/responses stream a plain text turn?
//   4. Which tool shapes does the plan route accept (top level, namespace,
//      additional_tools), and does a full tool round trip finish?
//   5. What does a refused request look like?
//   6. Does one token refresh work, and does the refresh token rotate?
//   7. Do two simultaneous streamed requests work?
//   8. How long did it all take, and is a plan name exposed?
//
// Safety rules, enforced in code and covered by scripts/siwc-probe.test.mjs:
//   - Tokens live in memory. The only disk copy is a 0600 file inside a fresh
//     0700 temp directory that is removed on success, on error and on Ctrl-C.
//   - The report holds statuses, error codes, model slugs, claim NAMES and
//     timings. Every string goes through one redactor (see sanitizeText).
//   - Only the two OpenAI hosts below are ever contacted.
//   - Never touches the keychain, ~/.codex or any other existing credential.
//   - At most MAX_INFERENCE_REQUESTS tiny inference requests.
//   - Refuses to run without a TTY and SIWC_PROBE_I_AM_THE_OWNER=1.
//
// Usage: SIWC_PROBE_I_AM_THE_OWNER=1 node scripts/siwc-probe.mjs

import { spawn } from "node:child_process";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants (all from OpenAI's token-sharing-open-source docs)
// ---------------------------------------------------------------------------

export const PROBE_VERSION = "1";
export const AUTH_ORIGIN = "https://auth.openai.com";
export const API_ORIGIN = "https://api.openai.com";
export const DEFAULT_ENDPOINTS = Object.freeze({
  issuer: AUTH_ORIGIN,
  authorizeUrl: `${AUTH_ORIGIN}/api/accounts/authorize`,
  tokenUrl: `${AUTH_ORIGIN}/api/accounts/oauth/token`,
  discoveryUrl: `${AUTH_ORIGIN}/.well-known/openid-configuration`,
  apiBase: `${API_ORIGIN}/v1`,
  resource: `${API_ORIGIN}/v1`,
  allowedOrigins: Object.freeze([AUTH_ORIGIN, API_ORIGIN]),
});
export const SCOPE =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const AGENT_NAME_HINT = "Colony";
export const CALLBACK_PATH = "/auth/callback";
export const FIXED_PORT = 1455;
export const MAX_INFERENCE_REQUESTS = 12;
export const SCRATCH_PREFIX = "siwc-probe-";
export const REQUIRED_OWNER_ENV = "SIWC_PROBE_I_AM_THE_OWNER";

/** Request fields the plan route rejects (preview-limitations page). */
export const PROHIBITED_FIELDS = Object.freeze([
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
  "previous_response_id",
]);

const LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";
const ID_TOKEN_CLOCK_SKEW_S = 5;
const SIGNALS = Object.freeze([
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
]);

// ---------------------------------------------------------------------------
// Redaction: one funnel for every string that reaches the screen
// ---------------------------------------------------------------------------

const JWT_RE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /\bBearer\s+\S+/gi;
const LONG_RUN_RE = /[A-Za-z0-9_\-+/=]{32,}/g;
const SAFE_CODE_WORDS_RE = /^[a-z]+(?:_[a-z0-9]{1,16}){2,}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Remembers every secret the probe handles so any later string can be scrubbed
 * of exact copies, including the pieces of a JWT.
 */
export class SecretRegistry {
  #secrets = new Set();

  /** Register a secret string (and, for a JWT, each dot-separated part). */
  add(value) {
    if (typeof value !== "string" || value.length < 8) return;
    this.#secrets.add(value);
    for (const part of value.split(".")) {
      if (part.length >= 8) this.#secrets.add(part);
    }
  }

  /** Replace every registered secret found in `text`. */
  scrub(text) {
    let out = text;
    const ordered = [...this.#secrets].sort((a, b) => b.length - a.length);
    for (const secret of ordered) out = out.split(secret).join("[redacted]");
    return out;
  }
}

/** Replace token-shaped strings that were never registered. */
export function scrubShapes(text) {
  return text
    .replace(JWT_RE, "[redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(LONG_RUN_RE, (run) =>
      SAFE_CODE_WORDS_RE.test(run) ? run : "[redacted]",
    );
}

/**
 * The single funnel for text shown to the owner: strips control characters,
 * scrubs registered secrets and token-shaped runs, and caps the length.
 */
export function sanitizeText(value, registry, maxLen = 160) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  let text = raw.replace(CONTROL_RE, " ");
  if (registry) text = registry.scrub(text);
  text = scrubShapes(text);
  return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

const SAFE_CODE_RE = /^[A-Za-z0-9_.:\-[\]]{1,64}$/;

/** An error code or parameter name: short identifier characters only. */
export function safeCode(value, registry) {
  if (typeof value !== "string" || value === "") return "-";
  if (!SAFE_CODE_RE.test(value)) return "(unrecognised)";
  return sanitizeText(value, registry, 64);
}

const SAFE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** A model slug: short identifier characters only. */
export function safeSlug(value) {
  return typeof value === "string" && SAFE_SLUG_RE.test(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Report rows and rendering
// ---------------------------------------------------------------------------

/**
 * Build one report row. Every field is normalised here so nothing free-form
 * can reach the table except through sanitizeText.
 */
export function makeRow(fields, registry) {
  const status = Number.isInteger(fields.http) ? fields.http : null;
  const ms = Number.isFinite(fields.ms)
    ? Math.max(0, Math.round(fields.ms))
    : null;
  return {
    id: sanitizeText(fields.id, registry, 8),
    title: sanitizeText(fields.title, registry, 60),
    outcome: ["pass", "fail", "skip", "info"].includes(fields.outcome)
      ? fields.outcome
      : "info",
    http:
      status !== null && status >= 100 && status <= 599 ? String(status) : "-",
    code: safeCode(fields.code, registry),
    param: safeCode(fields.param, registry),
    completed:
      fields.completed === true
        ? "yes"
        : fields.completed === false
          ? "no"
          : "-",
    ms: ms === null ? "-" : String(ms),
    note: sanitizeText(fields.note ?? "", registry, 200),
  };
}

function cell(text) {
  return String(text).replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "-";
}

/** Render the pasteable report: header facts, one table, short reading. */
export function renderReport({ rows, facts, reading }, registry) {
  const lines = [];
  lines.push("SIWC PROBE RESULT (no tokens, no email, no account ids)");
  for (const [key, value] of facts) {
    lines.push(
      `${sanitizeText(key, registry, 40)}: ${sanitizeText(value, registry, 200)}`,
    );
  }
  lines.push("");
  lines.push(
    "| Step | What | Result | HTTP | Code | Param | Completed | ms | Notes |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${[
        row.id,
        row.title,
        row.outcome,
        row.http,
        row.code,
        row.param,
        row.completed,
        row.ms,
        row.note,
      ]
        .map(cell)
        .join(" | ")} |`,
    );
  }
  if (reading.length > 0) {
    lines.push("");
    lines.push("Reading:");
    for (const line of reading)
      lines.push(`- ${sanitizeText(line, registry, 240)}`);
  }
  return lines.join("\n");
}

/** Turn the rows into the short go or no-go reading from the design page. */
export function deriveReading(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const passed = (id) => byId.get(id)?.outcome === "pass";
  const reading = [];
  if (!passed("S1") && !passed("S1b")) {
    reading.push("Sign-in did not complete. Nothing after it was proven.");
    return reading;
  }
  if (byId.has("P1") && !passed("P1")) {
    reading.push(
      "P1 failed. Stop and ask OpenAI through the interest form before building more.",
    );
    return reading;
  }
  const variants = [
    ["P2", "top-level tools"],
    ["P3", "namespace"],
    ["P4", "additional_tools"],
  ];
  const callOk = variants.filter(([id]) => passed(id));
  if (callOk.length === 0 && byId.has("P2")) {
    reading.push(
      "No tool shape was accepted with a call returned. Route B (Codex app-server) is the likely path.",
    );
  } else if (callOk.length > 0) {
    reading.push(
      `Tool call returned via: ${callOk.map(([, n]) => n).join(", ")}.`,
    );
    const roundTrip = callOk.filter(
      ([id]) => passed(`${id}r`) || passed(`${id}r2`),
    );
    reading.push(
      roundTrip.length > 0
        ? `Full tool round trip finished via: ${roundTrip.map(([, n]) => n).join(", ")}. Route A is viable.`
        : "No full tool round trip finished. Check the P2r, P3r, P4r rows for the replay error.",
    );
  }
  if (byId.has("P6")) {
    reading.push(
      passed("P6")
        ? "Two simultaneous streams both completed (concurrency of 2 allowed)."
        : "Two simultaneous streams did not both complete. Set the per-install limit to 1.",
    );
  }
  return reading;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Refuse to run unless a human owner is at a terminal. */
export function checkOwnerRun({ env, stdin }) {
  if (env[REQUIRED_OWNER_ENV] !== "1") {
    return {
      ok: false,
      reason: `Refusing to run: ${REQUIRED_OWNER_ENV}=1 is not set. This probe signs in to a real ChatGPT account, so only the account owner runs it.`,
    };
  }
  if (!stdin || stdin.isTTY !== true) {
    return {
      ok: false,
      reason:
        "Refusing to run: stdin is not a terminal. Run it yourself in a terminal window.",
    };
  }
  if (env.CI) {
    return {
      ok: false,
      reason:
        "Refusing to run: CI is set. This probe is never run by automation.",
    };
  }
  return { ok: true, reason: "" };
}

/** True when this Node can run the probe (fetch, streams, base64url). */
export function nodeIsSupported(version = process.versions.node) {
  return Number.parseInt(version.split(".")[0], 10) >= 20;
}

// ---------------------------------------------------------------------------
// Scratch directory: the only place a token may touch disk
// ---------------------------------------------------------------------------

/**
 * Create a fresh 0700 scratch directory. `removeSync` is idempotent and
 * returns whether the directory is gone.
 */
export function createScratch({
  parent = os.tmpdir(),
  prefix = SCRATCH_PREFIX,
} = {}) {
  const dir = mkdtempSync(path.join(parent, prefix));
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  let removed = false;
  const removeSync = () => {
    if (removed) return !existsSync(dir);
    removed = true;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `WARNING: could not delete ${dir} (${error?.code ?? "error"}). Delete that folder by hand.\n`,
      );
    }
    return !existsSync(dir);
  };
  return { dir, removeSync };
}

/**
 * Remove the scratch directory on process exit and on SIGINT, SIGTERM and
 * SIGHUP. Returns a function that uninstalls the handlers.
 */
export function installCleanupHandlers(
  scratch,
  { proc = process, exit = process.exit } = {},
) {
  const onExit = () => {
    scratch.removeSync();
  };
  proc.on("exit", onExit);
  const handlers = SIGNALS.map(([signal, code]) => {
    const handler = () => {
      scratch.removeSync();
      exit(code);
    };
    proc.on(signal, handler);
    return [signal, handler];
  });
  return () => {
    proc.off("exit", onExit);
    for (const [signal, handler] of handlers) proc.off(signal, handler);
  };
}

/** Remove leftovers of a previous run that was killed hard (SIGKILL, power loss). */
export function sweepStaleScratch({
  parent = os.tmpdir(),
  prefix = SCRATCH_PREFIX,
  now = Date.now(),
  maxAgeMs = 60 * 60_000,
} = {}) {
  let removed = 0;
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(prefix)) continue;
    const full = path.join(parent, name);
    try {
      const info = lstatSync(full);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      if (uid !== null && info.uid !== uid) continue;
      if (now - info.mtimeMs < maxAgeMs) continue;
      rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A directory that vanished or is unreadable is not ours to chase.
    }
  }
  return removed;
}

/** Write `text` to `file` atomically with owner-only permissions. */
export function writePrivateFileAtomic(file, text) {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

/** Octal permission strings for the scratch dir and file, or null on Windows. */
export function readModes(dir, file) {
  if (process.platform === "win32") return null;
  const octal = (target) =>
    (statSync(target).mode & 0o777).toString(8).padStart(4, "0");
  return { dir: octal(dir), file: octal(file) };
}

const HOST_ID_RE =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Load the persisted per-install host id, or create and persist one. */
export function loadOrCreateHostId(homeDir) {
  const file = path.join(homeDir, "host-id.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof parsed.ext_agent_host_id === "string" &&
      HOST_ID_RE.test(parsed.ext_agent_host_id)
    ) {
      return { id: parsed.ext_agent_host_id, created: false };
    }
  } catch {
    // Missing or unreadable file: create a fresh id below.
  }
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const id = `urn:uuid:${randomUUID()}`;
  writePrivateFileAtomic(
    file,
    `${JSON.stringify({ ext_agent_host_id: id })}\n`,
  );
  return { id, created: true };
}

// ---------------------------------------------------------------------------
// PKCE, state, nonce, authorize URL
// ---------------------------------------------------------------------------

/** base64url(SHA-256(verifier)) without padding (RFC 7636 S256). */
export function codeChallengeFor(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Fresh state, nonce and PKCE pair. Called once per sign-in attempt. */
export function newAttemptSecrets() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier,
    challenge: codeChallengeFor(verifier),
  };
}

const LOOPBACK_REDIRECT_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/auth\/callback$/;

/**
 * Build the authorize URL. First registration passes `agentNameHint`; a return
 * sign-in would omit it (not exercised by this probe). Exactly these
 * parameters are sent and nothing else.
 */
export function buildAuthorizeUrl({
  endpoints = DEFAULT_ENDPOINTS,
  clientId,
  agentNameHint,
  hostId,
  redirectUri,
  state,
  nonce,
  challenge,
}) {
  if (!LOOPBACK_REDIRECT_RE.test(redirectUri)) {
    throw new Error("redirect_uri must be http://127.0.0.1:PORT/auth/callback");
  }
  const params = [["client_id", clientId]];
  if (agentNameHint) params.push(["agent_name_hint", agentNameHint]);
  params.push(
    ["ext_agent_host_id", hostId],
    ["response_type", "code"],
    ["redirect_uri", redirectUri],
    ["scope", SCOPE],
    ["resource", endpoints.resource],
    ["state", state],
    ["nonce", nonce],
    ["code_challenge_method", "S256"],
    ["code_challenge", challenge],
  );
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${endpoints.authorizeUrl}?${query}`;
}

// ---------------------------------------------------------------------------
// Loopback callback listener
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

const PAGE_HEAD =
  "<!doctype html><meta charset=utf-8><title>Colony probe</title>";
const PAGE_OK = `${PAGE_HEAD}<p>Sign-in received. You can close this tab and return to the terminal.</p>`;
const PAGE_ERR = `${PAGE_HEAD}<p>Sign-in did not complete. Return to the terminal.</p>`;

/**
 * Listen on 127.0.0.1 only for exactly one valid callback.
 *
 * Resolves `result` with `{kind:"code", code, clientId, scope}`,
 * `{kind:"error", error}`, `{kind:"timeout"}` or `{kind:"closed"}`. A request
 * with the wrong method, host, path or state is rejected and does not consume
 * the attempt.
 */
export async function startCallbackListener({
  port = 0,
  expectedState,
  timeoutMs = 10 * 60_000,
}) {
  let settle;
  const result = new Promise((resolve) => {
    settle = resolve;
  });
  let consumed = false;
  let finished = false;
  let timer = null;
  let boundPort = port;

  const server = http.createServer((req, res) => {
    const reply = (status, body, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
        connection: "close",
      });
      res.end(body);
    };
    if (req.method !== "GET") return reply(405, "Method not allowed");
    if ((req.url ?? "").length > 4096) return reply(414, "URI too long");
    if (req.headers.host !== `127.0.0.1:${boundPort}`)
      return reply(400, "Bad host");
    let url;
    try {
      url = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
    } catch {
      return reply(400, "Bad request");
    }
    if (url.pathname !== CALLBACK_PATH) return reply(404, "Not found");
    if (consumed) return reply(410, "Already used");
    if (!safeEqual(url.searchParams.get("state") ?? "", expectedState)) {
      return reply(400, "State mismatch");
    }
    consumed = true;
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error) {
      reply(200, PAGE_ERR, "text/html; charset=utf-8");
      finish({ kind: "error", error });
    } else if (code) {
      reply(200, PAGE_OK, "text/html; charset=utf-8");
      finish({
        kind: "code",
        code,
        clientId: url.searchParams.get("client_id"),
        scope: url.searchParams.get("scope"),
      });
    } else {
      reply(400, "Missing code", "text/plain; charset=utf-8");
      finish({ kind: "error", error: "missing_code" });
    }
  });
  server.maxConnections = 8;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;

  function finish(outcome) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    // Let the success page flush, then drop every connection.
    setImmediate(() => {
      server.close();
      server.closeAllConnections?.();
    });
    settle(outcome);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  boundPort = server.address().port;
  timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

  return {
    server,
    port: boundPort,
    redirectUri: `http://127.0.0.1:${boundPort}${CALLBACK_PATH}`,
    result,
    close: () => finish({ kind: "closed" }),
  };
}

// ---------------------------------------------------------------------------
// HTTP: allow-listed origins, capped bodies, bounded time, SSE
// ---------------------------------------------------------------------------

/** Cut a thrown error down to a short label that cannot carry secrets. */
export function errorLabel(error) {
  const name = typeof error?.name === "string" ? error.name : "Error";
  const code = error?.cause?.code ?? error?.code;
  const label = typeof code === "string" ? `${name}:${code}` : name;
  return /^[A-Za-z0-9_:.-]{1,64}$/.test(label) ? label : "Error";
}

async function readCapped(res, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    total += chunk.byteLength;
    if (total > maxBytes)
      throw Object.assign(new Error("body too large"), {
        name: "BodyTooLarge",
      });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Split a growing SSE text buffer into complete events. */
export function drainSse(buffer) {
  const normalised = buffer.replace(/\r\n/g, "\n");
  const parts = normalised.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = [];
  for (const block of parts) {
    let name = null;
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    const text = data.join("\n");
    const json = tryJson(text);
    const type = typeof json?.type === "string" ? json.type : name;
    if (json && type) events.push({ type, data: json });
  }
  return { events, rest };
}

/**
 * Build the only HTTP client the probe uses. Every request is checked against
 * the origin allow-list, never follows redirects, and is bounded in time and
 * size.
 */
export function createHttp({
  allowedOrigins = DEFAULT_ENDPOINTS.allowedOrigins,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  streamIdleMs = 30_000,
  streamTotalMs = 90_000,
  maxBodyBytes = 262_144,
  maxStreamBytes = 524_288,
} = {}) {
  const guard = (url) => {
    const origin = new URL(url).origin;
    if (!allowedOrigins.includes(origin)) {
      throw Object.assign(new Error(`blocked origin ${origin}`), {
        name: "BlockedOrigin",
      });
    }
  };

  async function text(url, init = {}) {
    guard(url);
    const res = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await readCapped(res, maxBodyBytes);
    return {
      status: res.status,
      headers: res.headers,
      text: body,
      json: tryJson(body),
    };
  }

  async function stream(url, init, onEvent) {
    guard(url);
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), streamIdleMs);
    const total = setTimeout(() => controller.abort(), streamTotalMs);
    try {
      const res = await fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("text/event-stream")) {
        const body = await readCapped(res, maxBodyBytes);
        return {
          status: res.status,
          headers: res.headers,
          streamed: false,
          text: body,
          json: tryJson(body),
          truncated: false,
        };
      }
      let buffer = "";
      let bytes = 0;
      let truncated = false;
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), streamIdleMs);
        bytes += chunk.byteLength;
        if (bytes > maxStreamBytes) {
          truncated = true;
          controller.abort();
          break;
        }
        buffer += decoder.decode(chunk, { stream: true });
        const drained = drainSse(buffer);
        buffer = drained.rest;
        for (const event of drained.events) onEvent(event.type, event.data);
      }
      return {
        status: res.status,
        headers: res.headers,
        streamed: true,
        truncated,
      };
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
    }
  }

  return { text, stream, guard };
}

// ---------------------------------------------------------------------------
// ID token validation
// ---------------------------------------------------------------------------

function b64urlToBuffer(segment) {
  return Buffer.from(segment, "base64url");
}

function decodeJsonSegment(segment) {
  try {
    const value = JSON.parse(b64urlToBuffer(segment).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Decode a JWT without verifying it. Only for claim NAMES in the report. */
export function decodeJwtUnverified(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  return header && payload ? { header, payload } : null;
}

function verifySignature(alg, signingInput, signature, jwk) {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (alg === "RS256")
    return cryptoVerify("RSA-SHA256", signingInput, key, signature);
  if (alg === "ES256") {
    return cryptoVerify(
      "sha256",
      signingInput,
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  }
  return false;
}

/**
 * Validate an ID token the way the docs require: signature against the JWKS,
 * issuer, audience (the issued client id), expiry, nonce and subject. Returns
 * `{ok:true, claims, alg}` or `{ok:false, reason}` with a short reason code.
 */
export async function validateIdToken({
  idToken,
  getJwks,
  issuer,
  clientId,
  nonce,
  nowSeconds = Math.floor(Date.now() / 1000),
  allowedAlgs = ["RS256"],
}) {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) return { ok: false, reason: "not_a_jwt" };
  const decoded = decodeJwtUnverified(idToken);
  if (!decoded) return { ok: false, reason: "bad_encoding" };
  const { header, payload } = decoded;
  const alg = header.alg;
  if (
    typeof alg !== "string" ||
    !["RS256", "ES256"].includes(alg) ||
    !allowedAlgs.includes(alg)
  ) {
    return { ok: false, reason: "alg_not_allowed", alg: safeAlg(alg) };
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  const findKey = (jwks) => {
    const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
    if (kid) return keys.find((key) => key.kid === kid);
    return keys.length === 1 ? keys[0] : undefined;
  };
  let jwk = findKey(await getJwks(false));
  if (!jwk) jwk = findKey(await getJwks(true));
  if (!jwk) return { ok: false, reason: "unknown_kid", alg };
  if (jwk.kty !== (alg === "RS256" ? "RSA" : "EC"))
    return { ok: false, reason: "key_type_mismatch", alg };
  let signatureOk = false;
  try {
    signatureOk = verifySignature(
      alg,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      b64urlToBuffer(parts[2]),
      jwk,
    );
  } catch {
    return { ok: false, reason: "bad_key", alg };
  }
  if (!signatureOk) return { ok: false, reason: "bad_signature", alg };
  if (payload.iss !== issuer) return { ok: false, reason: "bad_issuer", alg };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId))
    return { ok: false, reason: "bad_audience", alg };
  if (
    typeof payload.exp !== "number" ||
    payload.exp + ID_TOKEN_CLOCK_SKEW_S < nowSeconds
  ) {
    return { ok: false, reason: "expired", alg };
  }
  if (typeof payload.iat !== "number")
    return { ok: false, reason: "missing_iat", alg };
  if (
    typeof payload.nbf === "number" &&
    payload.nbf - ID_TOKEN_CLOCK_SKEW_S > nowSeconds
  ) {
    return { ok: false, reason: "not_yet_valid", alg };
  }
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)) {
    return { ok: false, reason: "bad_nonce", alg };
  }
  if (typeof payload.sub !== "string" || payload.sub === "") {
    return { ok: false, reason: "missing_subject", alg };
  }
  return { ok: true, claims: payload, alg };
}

function safeAlg(alg) {
  return typeof alg === "string" && /^[A-Za-z0-9]{1,12}$/.test(alg)
    ? alg
    : "(odd)";
}

/** Pick the plan name if some claim exposes one. Only short plain words. */
export function findPlanHint(...objects) {
  const seen = [];
  const walk = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 3) return;
    for (const [key, inner] of Object.entries(value)) {
      if (
        /plan/i.test(key) &&
        typeof inner === "string" &&
        /^[A-Za-z0-9 _-]{1,32}$/.test(inner)
      ) {
        seen.push(inner);
      } else {
        walk(inner, depth + 1);
      }
    }
  };
  for (const object of objects) walk(object, 0);
  return seen[0] ?? null;
}

/** Claim NAMES (never values) for the report. */
export function claimNames(payload) {
  if (!payload || typeof payload !== "object") return [];
  const names = [];
  for (const [key, value] of Object.entries(payload)) {
    if (/^[A-Za-z0-9_:/.-]{1,64}$/.test(key)) names.push(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) {
        if (/^[A-Za-z0-9_-]{1,40}$/.test(inner))
          names.push(`${key.split("/").pop()}.${inner}`);
      }
    }
  }
  return names.slice(0, 30);
}

// ---------------------------------------------------------------------------
// OAuth requests
// ---------------------------------------------------------------------------

function formBody(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body.toString();
}

const FORM_HEADERS = Object.freeze({
  accept: "application/json",
  "content-type": "application/x-www-form-urlencoded",
});

/** Shape a token-endpoint reply, registering every secret it carries. */
export function readTokenResponse(reply, registry, now = Date.now()) {
  const json = reply.json && typeof reply.json === "object" ? reply.json : {};
  const errorCode =
    typeof json.error === "string" ? json.error : json.error?.code;
  if (reply.status !== 200) {
    return {
      ok: false,
      status: reply.status,
      code: typeof errorCode === "string" ? errorCode : null,
    };
  }
  const tokens = {
    access: typeof json.access_token === "string" ? json.access_token : null,
    refresh: typeof json.refresh_token === "string" ? json.refresh_token : null,
    id: typeof json.id_token === "string" ? json.id_token : null,
  };
  for (const secret of Object.values(tokens)) registry.add(secret);
  const scopes =
    typeof json.scope === "string"
      ? json.scope.split(/\s+/).filter(Boolean)
      : [];
  return {
    ok: tokens.access !== null,
    status: reply.status,
    code: tokens.access === null ? "no_access_token" : null,
    tokens,
    scopes,
    expiresIn: Number.isFinite(json.expires_in) ? json.expires_in : null,
    tokenType: typeof json.token_type === "string" ? json.token_type : null,
    earliestRefreshAt: parseTimestampMs(json.earliest_refresh_at, now),
    hasEarliestRefreshAt: json.earliest_refresh_at !== undefined,
  };
}

/** Accept unix seconds, unix milliseconds or an ISO string. */
export function parseTimestampMs(value, now = Date.now()) {
  let ms = null;
  if (typeof value === "number" && Number.isFinite(value))
    ms = value < 1e12 ? value * 1000 : value;
  else if (typeof value === "string") {
    const parsed = Date.parse(value);
    ms = Number.isNaN(parsed) ? null : parsed;
  }
  // Ignore absurd values (before 2020 or more than a year ahead).
  return ms !== null && ms > Date.UTC(2020, 0, 1) && ms < now + 365 * 86_400_000
    ? ms
    : null;
}

async function exchangeCode(
  client,
  { endpoints, clientId, code, verifier, redirectUri },
  registry,
) {
  const reply = await client.text(endpoints.tokenUrl, {
    method: "POST",
    headers: FORM_HEADERS,
    body: formBody({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: endpoints.resource,
    }),
  });
  return readTokenResponse(reply, registry);
}

async function refreshTokens(
  client,
  { endpoints, clientId, refreshToken },
  registry,
) {
  const reply = await client.text(endpoints.tokenUrl, {
    method: "POST",
    headers: FORM_HEADERS,
    body: formBody({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      resource: endpoints.resource,
    }),
  });
  return readTokenResponse(reply, registry);
}

async function revokeRefreshToken(
  client,
  { endpoint, clientId, refreshToken },
) {
  const reply = await client.text(endpoint, {
    method: "POST",
    headers: FORM_HEADERS,
    body: formBody({
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: clientId,
    }),
  });
  const code = typeof reply.json?.error === "string" ? reply.json.error : null;
  return { status: reply.status, code };
}

async function loadDiscovery(client, endpoints) {
  const reply = await client.text(endpoints.discoveryUrl, {
    headers: { accept: "application/json" },
  });
  const doc = reply.json;
  if (reply.status !== 200 || !doc || typeof doc !== "object") {
    return { ok: false, status: reply.status, reason: "no_discovery_document" };
  }
  if (doc.issuer !== endpoints.issuer)
    return { ok: false, status: reply.status, reason: "bad_issuer" };
  const algs = Array.isArray(doc.id_token_signing_alg_values_supported)
    ? doc.id_token_signing_alg_values_supported.filter(
        (a) => typeof a === "string",
      )
    : [];
  return {
    ok: true,
    status: reply.status,
    jwksUri: typeof doc.jwks_uri === "string" ? doc.jwks_uri : null,
    revocationEndpoint:
      typeof doc.revocation_endpoint === "string"
        ? doc.revocation_endpoint
        : null,
    tokenEndpointMatches: doc.token_endpoint === endpoints.tokenUrl,
    authorizeEndpointMatches:
      doc.authorization_endpoint === endpoints.authorizeUrl,
    algs,
  };
}

// ---------------------------------------------------------------------------
// Responses API: request bodies, stream summary
// ---------------------------------------------------------------------------

const PROBE_FUNCTION = Object.freeze({
  type: "function",
  name: "get_time",
  description: "Returns the current time as a short sentence.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
});
const TEXT_INSTRUCTIONS =
  "You are a connection probe. Keep every reply under ten words.";
const TOOL_INSTRUCTIONS =
  "You are a connection probe. When asked for the time, call the get_time tool, then answer in one short sentence.";
const TOOL_PROMPT = "What time is it? Use the get_time tool.";

/** The three tool shapes under test, as the docs and API reference describe them. */
export const TOOL_VARIANTS = Object.freeze([
  {
    id: "P2",
    name: "top-level tools",
    extra: () => ({ tools: [{ ...PROBE_FUNCTION }] }),
    prefix: () => [],
  },
  {
    id: "P3",
    name: "namespace",
    extra: () => ({
      tools: [
        {
          type: "namespace",
          name: "colony",
          description: "Colony probe tools.",
          tools: [{ ...PROBE_FUNCTION }],
        },
      ],
    }),
    prefix: () => [],
  },
  {
    id: "P4",
    name: "additional_tools",
    extra: () => ({}),
    prefix: () => [
      {
        type: "additional_tools",
        role: "developer",
        tools: [{ ...PROBE_FUNCTION }],
      },
    ],
  },
]);

/** Plain text turn: instructions, string user input, store false, stream true. */
export function buildTextBody(model) {
  return {
    model,
    instructions: TEXT_INSTRUCTIONS,
    input: [{ role: "user", content: "Say exactly: Hello, world!" }],
    store: false,
    stream: true,
  };
}

/** First turn of a tool probe in one of the three shapes. */
export function buildToolBody(model, variant) {
  return {
    model,
    instructions: TOOL_INSTRUCTIONS,
    input: [...variant.prefix(), { role: "user", content: TOOL_PROMPT }],
    ...variant.extra(),
    store: false,
    stream: true,
  };
}

/** Second turn: replay the call and return its output (history is resent, store is false). */
export function buildReplayBody(
  model,
  variant,
  callItem,
  { minimal = false } = {},
) {
  const call = minimal
    ? {
        type: "function_call",
        call_id: callItem.call_id,
        name: callItem.name,
        arguments: callItem.arguments,
        ...(callItem.namespace ? { namespace: callItem.namespace } : {}),
      }
    : callItem;
  const output = {
    type: "function_call_output",
    call_id: callItem.call_id,
    output: "The time is 12:00 UTC.",
    ...(callItem.namespace ? { namespace: callItem.namespace } : {}),
  };
  return {
    model,
    instructions: TOOL_INSTRUCTIONS,
    input: [
      ...variant.prefix(),
      { role: "user", content: TOOL_PROMPT },
      call,
      output,
    ],
    ...variant.extra(),
    store: false,
    stream: true,
  };
}

/** Throws when a body sets a prohibited field or a system-role item. */
export function assertSupportedBody(body) {
  for (const field of PROHIBITED_FIELDS) {
    if (field in body)
      throw new Error(`prohibited field in probe body: ${field}`);
  }
  if (body.store !== false || body.stream !== true)
    throw new Error("store must be false and stream true");
  if (typeof body.instructions !== "string")
    throw new Error("instructions must be a string");
  for (const item of body.input ?? []) {
    if (item?.role === "system")
      throw new Error("system role items are rejected by the plan route");
  }
}

/** Start an empty summary of one streamed response. */
export function newStreamSummary() {
  return {
    types: new Set(),
    deltaChars: 0,
    completed: false,
    failedCode: null,
    failedParam: null,
    incomplete: false,
    errorCode: null,
    errorParam: null,
    items: [],
    usage: null,
  };
}

/** Fold one SSE event into the summary. */
export function applyEvent(summary, type, data) {
  if (/^[a-z_.]{1,48}$/.test(type)) summary.types.add(type);
  if (type === "response.output_text.delta" && typeof data.delta === "string") {
    summary.deltaChars += data.delta.length;
  } else if (
    type === "response.output_item.done" &&
    data.item &&
    typeof data.item === "object"
  ) {
    if (summary.items.length < 20) summary.items.push(data.item);
  } else if (type === "response.completed") {
    summary.completed = true;
    const output = data.response?.output;
    if (summary.items.length === 0 && Array.isArray(output))
      summary.items = output.slice(0, 20);
    const usage = data.response?.usage;
    if (usage && typeof usage === "object") {
      summary.usage = {
        input: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
        output: Number.isFinite(usage.output_tokens)
          ? usage.output_tokens
          : null,
      };
    }
  } else if (type === "response.failed") {
    const error = data.response?.error;
    summary.failedCode =
      typeof error?.code === "string" ? error.code : "unknown_error";
    summary.failedParam = typeof error?.param === "string" ? error.param : null;
  } else if (type === "response.incomplete") {
    summary.incomplete = true;
  } else if (type === "error") {
    const code = data.code ?? data.error?.code;
    const param = data.param ?? data.error?.param;
    summary.errorCode = typeof code === "string" ? code : "unknown_error";
    summary.errorParam = typeof param === "string" ? param : null;
  }
}

/** `error.code` and `error.param` from a non-stream error body, if present. */
export function extractError(json) {
  if (!json || typeof json !== "object")
    return { code: null, param: null, detail: null };
  const error =
    json.error && typeof json.error === "object" ? json.error : null;
  return {
    code:
      typeof error?.code === "string"
        ? error.code
        : typeof json.error === "string"
          ? json.error
          : null,
    param: typeof error?.param === "string" ? error.param : null,
    detail: typeof json.detail === "string" ? json.detail : null,
  };
}

/** The function_call item the model produced, if any. */
export function findCallItem(summary) {
  return (
    summary.items.find(
      (item) => item?.type === "function_call" && item.name === "get_time",
    ) ?? null
  );
}

function keyNames(object) {
  return Object.keys(object ?? {})
    .filter((key) => /^[A-Za-z0-9_]{1,32}$/.test(key))
    .sort()
    .join(",");
}

function interestingHeaders(headers) {
  const out = [];
  for (const [name, value] of headers) {
    if (
      /limit|usage|plan|reset|remaining|quota/i.test(name) &&
      /^[a-z0-9-]{1,48}$/.test(name)
    ) {
      out.push(/^[0-9.]{1,12}$/.test(value) ? `${name}=${value}` : name);
    }
    if (out.length >= 6) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The inference runner: one place that counts and bounds every request
// ---------------------------------------------------------------------------

function createInferenceRunner({ client, endpoints, clock, maxRequests }) {
  let used = 0;
  return {
    get used() {
      return used;
    },
    /** Send one streamed Responses request. Returns `{skipped}` when the budget is spent. */
    async run(body, token, { allowProhibited = false } = {}) {
      if (used >= maxRequests) return { skipped: "budget" };
      if (!allowProhibited) assertSupportedBody(body);
      used += 1;
      const started = clock();
      const summary = newStreamSummary();
      try {
        const reply = await client.stream(
          `${endpoints.apiBase}/responses`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              accept: "text/event-stream",
            },
            body: JSON.stringify(body),
          },
          (type, data) => applyEvent(summary, type, data),
        );
        return {
          status: reply.status,
          headers: reply.headers,
          streamed: reply.streamed,
          truncated: reply.truncated,
          error: reply.streamed ? null : extractError(reply.json),
          summary,
          ms: clock() - started,
        };
      } catch (error) {
        return {
          transportError: errorLabel(error),
          summary,
          ms: clock() - started,
        };
      }
    },
  };
}

/** Turn one inference result into the row fields shared by every probe. */
export function describeInference(result, { expectCall = false } = {}) {
  if (result.skipped)
    return { outcome: "skip", note: `skipped: ${result.skipped}` };
  if (result.transportError) {
    return {
      outcome: "fail",
      note: `transport: ${result.transportError}`,
      ms: result.ms,
    };
  }
  const { summary } = result;
  const error = result.error ?? { code: null, param: null, detail: null };
  const streamedOk = result.status === 200 && result.streamed;
  const code = streamedOk
    ? (summary.failedCode ?? summary.errorCode)
    : error.code;
  const param = streamedOk
    ? (summary.failedParam ?? summary.errorParam)
    : error.param;
  const notes = [];
  if (summary.types.size > 0) {
    const names = [...summary.types];
    notes.push(
      `events: ${names.slice(0, 8).join(",")}${names.length > 8 ? `,+${names.length - 8}` : ""}`,
    );
  }
  if (summary.deltaChars > 0) notes.push(`text chars: ${summary.deltaChars}`);
  if (summary.usage)
    notes.push(
      `tokens in/out: ${summary.usage.input ?? "?"}/${summary.usage.output ?? "?"}`,
    );
  if (summary.incomplete) notes.push("response.incomplete seen");
  if (result.truncated) notes.push("stream cut at size cap");
  if (error.detail) notes.push(`detail: ${error.detail}`);
  const headers = result.headers ? interestingHeaders(result.headers) : [];
  if (headers.length > 0) notes.push(`headers: ${headers.join(" ")}`);
  const call = findCallItem(summary);
  if (call) notes.push(`call item keys: ${keyNames(call)}`);
  if (call?.namespace)
    notes.push(`namespace echoed: ${sanitizeShort(call.namespace)}`);
  const completed = summary.completed;
  const pass =
    streamedOk && completed && !code && (!expectCall || call !== null);
  if (expectCall && streamedOk && completed && !call)
    notes.push("accepted, but the model did not call the tool");
  return {
    outcome: pass ? "pass" : "fail",
    http: result.status,
    code,
    param,
    completed,
    ms: result.ms,
    note: notes.join("; "),
  };
}

function sanitizeShort(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(value)
    ? value
    : "(odd)";
}

// ---------------------------------------------------------------------------
// Browser and terminal helpers
// ---------------------------------------------------------------------------

/** Open the system default browser. Resolves true when the opener started. */
export function openInBrowser(
  url,
  { platform = process.platform, spawnImpl = spawn } = {},
) {
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd.exe";
    args = ["/d", "/s", "/c", "start", '""', url.replace(/&/g, "^&")];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolve) => {
    try {
      const child = spawnImpl(command, args, {
        stdio: "ignore",
        detached: true,
        windowsVerbatimArguments: platform === "win32",
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Resolve when the owner presses Enter. `cancel` stops listening. */
export function waitForEnter(stdin = process.stdin) {
  let onData;
  const promise = new Promise((resolve) => {
    onData = () => resolve("enter");
    stdin.once("data", onData);
    stdin.resume();
  });
  return {
    promise,
    cancel() {
      stdin.off("data", onData);
      stdin.pause();
    },
  };
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/**
 * Run the whole probe. Every external effect is injected, so the same code is
 * exercised by the local fake issuer in the tests and by the real service when
 * the owner runs it.
 */
export async function runProbe(deps) {
  const {
    endpoints = DEFAULT_ENDPOINTS,
    client,
    registry,
    scratch,
    hostId,
    openBrowser,
    enterSignal = () => ({ promise: new Promise(() => {}), cancel() {} }),
    say = () => {},
    clock = () => performance.now(),
    listenerTimeoutMs = 10 * 60_000,
    ports = [0, FIXED_PORT],
    maxInference = MAX_INFERENCE_REQUESTS,
    printUrl = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = deps;

  const rows = [];
  const facts = [];
  const add = (fields) => {
    rows.push(makeRow(fields, registry));
  };
  const runStart = clock();
  const inference = createInferenceRunner({
    client,
    endpoints,
    clock,
    maxRequests: maxInference,
  });
  const credentialFile = path.join(scratch.dir, "credentials.json");

  // -- discovery ------------------------------------------------------------
  say("Reading OpenAI's sign-in configuration...");
  let discovery;
  const discStart = clock();
  try {
    discovery = await loadDiscovery(client, endpoints);
  } catch (error) {
    discovery = { ok: false, status: null, reason: errorLabel(error) };
  }
  add({
    id: "D1",
    title: "Discovery document",
    outcome: discovery.ok ? "pass" : "fail",
    http: discovery.status,
    code: discovery.ok ? null : discovery.reason,
    ms: clock() - discStart,
    note: discovery.ok
      ? `jwks_uri: ${discovery.jwksUri ? "yes" : "no"}; revocation_endpoint: ${discovery.revocationEndpoint ? "yes" : "no"}; token endpoint matches docs: ${discovery.tokenEndpointMatches ? "yes" : "no"}; authorize endpoint matches docs: ${discovery.authorizeEndpointMatches ? "yes" : "no"}; algs: ${discovery.algs.join(",") || "none listed"}`
      : "",
  });
  if (!discovery.ok) return finish("stopped: no discovery document");

  let jwksCache = null;
  const getJwks = async (force) => {
    if (jwksCache && !force) return jwksCache;
    if (!discovery.jwksUri) throw new Error("no jwks_uri");
    const reply = await client.text(discovery.jwksUri, {
      headers: { accept: "application/json" },
    });
    if (reply.status !== 200 || !reply.json)
      throw new Error(`jwks http ${reply.status}`);
    jwksCache = reply.json;
    return jwksCache;
  };

  // -- sign-in (random port first, then the fixed port) -------------------------
  let signIn = null;
  let attemptNo = 0;
  for (const port of ports) {
    attemptNo += 1;
    const rowId = attemptNo === 1 ? "S1" : "S1b";
    const secrets = newAttemptSecrets();
    for (const value of Object.values(secrets)) registry.add(value);
    const attemptStart = clock();
    let listener;
    try {
      listener = await startCallbackListener({
        port,
        expectedState: secrets.state,
        timeoutMs: listenerTimeoutMs,
      });
    } catch (error) {
      add({
        id: rowId,
        title:
          port === 0 ? "Sign-in on a random port" : `Sign-in on port ${port}`,
        outcome: "fail",
        code: errorLabel(error),
        note: "could not start the loopback listener",
      });
      continue;
    }
    const url = buildAuthorizeUrl({
      endpoints,
      clientId: DYNAMIC_CLIENT_ID,
      agentNameHint: AGENT_NAME_HINT,
      hostId,
      redirectUri: listener.redirectUri,
      ...secrets,
    });
    say(
      `Listener ready on 127.0.0.1:${listener.port}. Opening your browser...`,
    );
    printUrl(url);
    const opened = await openBrowser(url);
    if (!opened)
      say("Could not open a browser. Paste the address above into one.");
    say(
      "Sign in, check the app is named Colony, and approve. If the page shows an error instead, press Enter here to retry on the fixed port.",
    );
    const enter = enterSignal();
    const outcome = await Promise.race([
      listener.result,
      enter.promise.then(() => ({ kind: "enter" })),
    ]);
    enter.cancel();
    listener.close();
    const title =
      port === 0 ? "Sign-in on a random port" : `Sign-in on port ${port}`;
    const portNote = `port ${listener.port}`;
    if (outcome.kind === "code") {
      add({
        id: rowId,
        title,
        outcome: "pass",
        ms: clock() - attemptStart,
        note: `${portNote}; callback had client_id: ${outcome.clientId ? "yes" : "no"}; scope in callback: ${outcome.scope ? "yes" : "no"}`,
      });
      signIn = {
        secrets,
        redirectUri: listener.redirectUri,
        callback: outcome,
      };
      break;
    }
    const why =
      outcome.kind === "error"
        ? {
            code: outcome.error,
            note: `${portNote}; the sign-in page returned an error`,
          }
        : outcome.kind === "enter"
          ? {
              code: "owner_retry",
              note: `${portNote}; owner pressed Enter to retry`,
            }
          : { code: outcome.kind, note: portNote };
    add({
      id: rowId,
      title,
      outcome: "fail",
      ms: clock() - attemptStart,
      ...why,
    });
    if (outcome.kind === "error" && outcome.error === "access_denied") break;
    if (outcome.kind === "timeout") break;
  }
  if (!signIn) return finish("stopped: sign-in did not complete");

  // -- code exchange ------------------------------------------------------------
  const issuedClientId = signIn.callback.clientId;
  if (!issuedClientId || issuedClientId === DYNAMIC_CLIENT_ID) {
    add({
      id: "S2",
      title: "Registration returned a client id",
      outcome: "fail",
      code: "registration_incomplete",
    });
    return finish("stopped: no issued client id");
  }
  registry.add(signIn.callback.code);
  say("Exchanging the sign-in code for tokens...");
  const exchangeStart = clock();
  let exchange;
  try {
    exchange = await exchangeCode(
      client,
      {
        endpoints,
        clientId: issuedClientId,
        code: signIn.callback.code,
        verifier: signIn.secrets.verifier,
        redirectUri: signIn.redirectUri,
      },
      registry,
    );
  } catch (error) {
    exchange = { ok: false, status: null, code: errorLabel(error) };
  }
  if (!exchange.ok) {
    add({
      id: "S2",
      title: "Code exchange",
      outcome: "fail",
      http: exchange.status,
      code: exchange.code,
      ms: clock() - exchangeStart,
    });
    return finish("stopped: code exchange failed");
  }
  const hasPlanScope = exchange.scopes.includes(PLAN_SCOPE);
  add({
    id: "S2",
    title: "Code exchange and registration",
    outcome: hasPlanScope ? "pass" : "fail",
    http: exchange.status,
    code: hasPlanScope ? null : "plan_scope_missing",
    ms: clock() - exchangeStart,
    note: [
      `issued client_id prefix: ${issuedClientId.startsWith("oaiapp_") ? "oaiapp_" : "other"}`,
      `scopes: ${exchange.scopes.filter((s) => /^[a-z._]{1,40}$/.test(s)).join(" ")}`,
      `expires_in: ${exchange.expiresIn ?? "?"}`,
      `earliest_refresh_at: ${exchange.hasEarliestRefreshAt ? "present" : "absent"}`,
      `refresh token: ${exchange.tokens.refresh ? "yes" : "no"}`,
      `id token: ${exchange.tokens.id ? "yes" : "no"}`,
    ].join("; "),
  });

  // -- ID token -----------------------------------------------------------------
  let claims = null;
  const idStart = clock();
  if (exchange.tokens.id) {
    const allowed = discovery.algs.length > 0 ? discovery.algs : ["RS256"];
    let verdict;
    try {
      verdict = await validateIdToken({
        idToken: exchange.tokens.id,
        getJwks,
        issuer: endpoints.issuer,
        clientId: issuedClientId,
        nonce: signIn.secrets.nonce,
        allowedAlgs: allowed,
      });
    } catch (error) {
      verdict = { ok: false, reason: errorLabel(error) };
    }
    const decoded = decodeJwtUnverified(exchange.tokens.id);
    if (verdict.ok) claims = verdict.claims;
    const names = claimNames(decoded?.payload);
    add({
      id: "S3",
      title: "ID token validation",
      outcome: verdict.ok ? "pass" : "fail",
      code: verdict.ok ? null : verdict.reason,
      ms: clock() - idStart,
      note: [
        `alg: ${safeAlg(verdict.alg ?? decoded?.header?.alg)}`,
        `kid present: ${typeof decoded?.header?.kid === "string" ? "yes" : "no"}`,
        `email claim present: ${typeof decoded?.payload?.email === "string" ? "yes" : "no"}`,
        `claim names: ${names.join(",")}`,
        verdict.ok ? "" : "continuing to probe the API anyway",
      ]
        .filter(Boolean)
        .join("; "),
    });
  } else {
    add({
      id: "S3",
      title: "ID token validation",
      outcome: "fail",
      code: "no_id_token",
    });
  }

  const accessDecoded = decodeJwtUnverified(exchange.tokens.access);
  let planName = findPlanHint(
    claims ?? decodeJwtUnverified(exchange.tokens.id)?.payload,
    accessDecoded?.payload,
  );
  let accessToken = exchange.tokens.access;
  let refreshToken = exchange.tokens.refresh;
  let record = {
    issuer: endpoints.issuer,
    client_id: issuedClientId,
    ext_agent_host_id: hostId,
    id_token: exchange.tokens.id,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: exchange.tokenType ?? "Bearer",
    expires_in: exchange.expiresIn,
    scopes: exchange.scopes,
    saved_at: new Date().toISOString(),
  };
  writePrivateFileAtomic(credentialFile, `${JSON.stringify(record)}\n`);
  const modes = readModes(scratch.dir, credentialFile);
  add({
    id: "F1",
    title: "Credential file in scratch folder",
    outcome: modes
      ? modes.dir === "0700" && modes.file === "0600"
        ? "pass"
        : "fail"
      : "info",
    note: modes
      ? `modes dir ${modes.dir}, file ${modes.file}; atomic write; deleted at exit`
      : "mode bits not applicable on this OS; deleted at exit",
  });

  // -- models and inference -----------------------------------------------------
  let canInfer = hasPlanScope;
  let modelSlug = null;
  let models = [];
  let limitSeen = false;
  if (!canInfer) {
    add({
      id: "M1",
      title: "GET /v1/models",
      outcome: "skip",
      note: "plan scope not granted, so no inference (per the docs)",
    });
  } else {
    say("Listing models...");
    const modelsStart = clock();
    try {
      const reply = await client.text(`${endpoints.apiBase}/models`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });
      const list = Array.isArray(reply.json?.models) ? reply.json.models : [];
      models = list
        .filter((m) => m?.visibility === "list")
        .map((m) => safeSlug(m.slug))
        .filter(Boolean);
      const err = extractError(reply.json);
      planName = planName ?? findPlanHint(reply.json);
      add({
        id: "M1",
        title: "GET /v1/models",
        outcome: reply.status === 200 && models.length > 0 ? "pass" : "fail",
        http: reply.status,
        code: err.code,
        param: err.param,
        ms: clock() - modelsStart,
        note: `total ${list.length}; listed ${models.length}; slugs in server order: ${models.slice(0, 12).join(", ")}${err.detail ? `; detail: ${err.detail}` : ""}`,
      });
    } catch (error) {
      add({
        id: "M1",
        title: "GET /v1/models",
        outcome: "fail",
        code: errorLabel(error),
        ms: clock() - modelsStart,
      });
    }
    canInfer = models.length > 0;
  }

  const trackLimit = (described) => {
    if (described.code === LIMIT_CODE || described.http === 429)
      limitSeen = true;
  };

  if (canInfer) {
    // P1: plain text. If the first slug is refused as a model problem, try the next one.
    say("P1: plain text turn...");
    let p1 = null;
    for (const slug of models.slice(0, 3)) {
      const result = await inference.run(buildTextBody(slug), accessToken);
      const described = describeInference(result);
      trackLimit(described);
      p1 = { slug, described };
      if (described.outcome === "pass" || ![400, 404].includes(result.status))
        break;
    }
    if (p1) {
      add({ id: "P1", title: `Plain text turn (${p1.slug})`, ...p1.described });
      if (p1.described.outcome === "pass") modelSlug = p1.slug;
    }
    if (!modelSlug) canInfer = false;
  }

  const callsReturned = [];
  if (canInfer && !limitSeen) {
    for (const variant of TOOL_VARIANTS) {
      if (limitSeen) break;
      say(`${variant.id}: tool call, ${variant.name}...`);
      const result = await inference.run(
        buildToolBody(modelSlug, variant),
        accessToken,
      );
      const described = describeInference(result, { expectCall: true });
      trackLimit(described);
      add({
        id: variant.id,
        title: `Tool call: ${variant.name}`,
        ...described,
      });
      const call = findCallItem(result.summary ?? newStreamSummary());
      if (described.outcome === "pass" && call)
        callsReturned.push({ variant, call });
    }
    // Full round trip per working shape: replay the call as returned, then
    // once (across the whole run) retry with a minimal replay if it is refused.
    let minimalRetryUsed = false;
    for (const { variant, call } of callsReturned) {
      if (limitSeen) break;
      say(`${variant.id}r: tool round trip, ${variant.name}...`);
      const attempts = [
        {
          id: `${variant.id}r`,
          title: `Tool round trip: ${variant.name}`,
          minimal: false,
        },
      ];
      for (let i = 0; i < attempts.length; i += 1) {
        const attempt = attempts[i];
        const result = await inference.run(
          buildReplayBody(modelSlug, variant, call, {
            minimal: attempt.minimal,
          }),
          accessToken,
        );
        const described = describeInference(result);
        trackLimit(described);
        const finalText = (result.summary?.deltaChars ?? 0) > 0;
        const ok = described.outcome === "pass" && finalText;
        add({
          id: attempt.id,
          title: attempt.title,
          ...described,
          outcome: described.outcome === "skip" ? "skip" : ok ? "pass" : "fail",
          note: `${described.note}${described.outcome === "pass" && !finalText ? "; no final text" : ""}`,
        });
        if (
          !ok &&
          result.status === 400 &&
          !attempt.minimal &&
          !minimalRetryUsed
        ) {
          minimalRetryUsed = true;
          attempts.push({
            id: `${variant.id}r2`,
            title: `Round trip, minimal replay: ${variant.name}`,
            minimal: true,
          });
        }
      }
    }
  }

  // P6: two simultaneous streamed requests.
  if (canInfer && !limitSeen) {
    say("P6: two simultaneous streamed requests...");
    const started = clock();
    const pair = await Promise.all([
      inference.run(buildTextBody(modelSlug), accessToken),
      inference.run(buildTextBody(modelSlug), accessToken),
    ]);
    const described = pair.map((result) => describeInference(result));
    for (const d of described) trackLimit(d);
    const both = described.every((d) => d.outcome === "pass");
    add({
      id: "P6",
      title: "Two simultaneous streams",
      outcome: described.some((d) => d.outcome === "skip")
        ? "skip"
        : both
          ? "pass"
          : "fail",
      http:
        described.map((d) => d.http).find((h) => h && h !== 200) ??
        described[0].http,
      code: described.map((d) => d.code).find(Boolean) ?? null,
      completed: described.every((d) => d.completed === true),
      ms: clock() - started,
      note: `statuses: ${described.map((d) => d.http ?? "-").join(" and ")}; completed: ${described.map((d) => (d.completed ? "yes" : "no")).join(" and ")}`,
    });
  }

  // R1: what a refusal looks like. A prohibited field is rejected before any model runs.
  if (canInfer && !limitSeen) {
    say("R1: one deliberately refused request (prohibited field)...");
    const body = { ...buildTextBody(modelSlug), max_output_tokens: 16 };
    const result = await inference.run(body, accessToken, {
      allowProhibited: true,
    });
    const described = describeInference(result);
    add({
      id: "R1",
      title: "Refusal shape (max_output_tokens sent on purpose)",
      ...described,
      outcome: described.outcome === "skip" ? "skip" : "info",
    });
  }
  if (limitSeen) {
    add({
      id: "R2",
      title: "Usage limit reached during the probe",
      outcome: "info",
      code: LIMIT_CODE,
      note: "stopped sending requests, as the docs say",
    });
  }
  if (!modelSlug && hasPlanScope) {
    for (const id of ["P2", "P3", "P4", "P6"]) {
      if (!rows.some((row) => row.id === id))
        add({ id, title: "Not run", outcome: "skip", note: "P1 did not pass" });
    }
  }

  // -- refresh --------------------------------------------------------------------
  if (refreshToken) {
    try {
      record = JSON.parse(readFileSync(credentialFile, "utf8"));
    } catch {
      add({
        id: "T1",
        title: "Refresh",
        outcome: "fail",
        code: "credential_file_unreadable",
      });
      record = null;
    }
  }
  if (record && refreshToken) {
    if (exchange.earliestRefreshAt) {
      const waitMs = exchange.earliestRefreshAt - Date.now();
      if (waitMs > 0 && waitMs <= 90_000) {
        say(`Waiting ${Math.ceil(waitMs / 1000)}s for earliest_refresh_at...`);
        await sleep(waitMs + 500);
      }
    }
    say("T1: refreshing the token once...");
    const refreshStart = clock();
    let refreshed;
    try {
      refreshed = await refreshTokens(
        client,
        {
          endpoints,
          clientId: record.client_id,
          refreshToken: record.refresh_token,
        },
        registry,
      );
    } catch (error) {
      refreshed = { ok: false, status: null, code: errorLabel(error) };
    }
    if (refreshed.ok) {
      const rotated =
        Boolean(refreshed.tokens.refresh) &&
        refreshed.tokens.refresh !== record.refresh_token;
      const oldAccess = accessToken;
      record = {
        ...record,
        access_token: refreshed.tokens.access,
        refresh_token: refreshed.tokens.refresh ?? record.refresh_token,
        id_token: refreshed.tokens.id ?? record.id_token,
        expires_in: refreshed.expiresIn,
        scopes: refreshed.scopes.length > 0 ? refreshed.scopes : record.scopes,
        saved_at: new Date().toISOString(),
      };
      writePrivateFileAtomic(credentialFile, `${JSON.stringify(record)}\n`);
      accessToken = record.access_token;
      refreshToken = record.refresh_token;
      add({
        id: "T1",
        title: "Refresh token exchange",
        outcome: "pass",
        http: refreshed.status,
        ms: clock() - refreshStart,
        note: `refresh token rotated: ${rotated ? "yes" : "no"}; new access token differs: ${accessToken !== oldAccess ? "yes" : "no"}; expires_in: ${refreshed.expiresIn ?? "?"}; plan scope kept: ${refreshed.scopes.length === 0 ? "scope not returned" : refreshed.scopes.includes(PLAN_SCOPE) ? "yes" : "no"}; earliest_refresh_at: ${refreshed.hasEarliestRefreshAt ? "present" : "absent"}; new id token: ${refreshed.tokens.id ? "yes" : "no"}`,
      });
      // The refreshed token must work, and the old one's fate matters for single-writer refresh.
      for (const [id, title, token] of [
        ["T2", "Refreshed access token at /v1/models", accessToken],
        ["T3", "Previous access token at /v1/models after refresh", oldAccess],
      ]) {
        const t = clock();
        try {
          const reply = await client.text(`${endpoints.apiBase}/models`, {
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
            },
          });
          const err = extractError(reply.json);
          add({
            id,
            title,
            outcome:
              id === "T2" ? (reply.status === 200 ? "pass" : "fail") : "info",
            http: reply.status,
            code: err.code,
            ms: clock() - t,
          });
        } catch (error) {
          add({
            id,
            title,
            outcome: id === "T2" ? "fail" : "info",
            code: errorLabel(error),
            ms: clock() - t,
          });
        }
      }
    } else {
      add({
        id: "T1",
        title: "Refresh token exchange",
        outcome: "fail",
        http: refreshed.status,
        code: refreshed.code,
        ms: clock() - refreshStart,
      });
    }
  } else if (!refreshToken) {
    add({
      id: "T1",
      title: "Refresh token exchange",
      outcome: "skip",
      code: "no_refresh_token",
    });
  }

  // -- revoke so nothing stays valid after the probe ----------------------------------
  if (refreshToken && discovery.revocationEndpoint) {
    const revokeStart = clock();
    try {
      const reply = await revokeRefreshToken(client, {
        endpoint: discovery.revocationEndpoint,
        clientId: issuedClientId,
        refreshToken,
      });
      add({
        id: "V1",
        title: "Revoke the refresh token (cleanup)",
        outcome: reply.status === 200 ? "pass" : "fail",
        http: reply.status,
        code: reply.code,
        ms: clock() - revokeStart,
      });
    } catch (error) {
      add({
        id: "V1",
        title: "Revoke the refresh token (cleanup)",
        outcome: "fail",
        code: errorLabel(error),
        ms: clock() - revokeStart,
      });
    }
  } else if (refreshToken) {
    add({
      id: "V1",
      title: "Revoke the refresh token (cleanup)",
      outcome: "skip",
      code: "no_revocation_endpoint",
    });
  }

  facts.push([
    "plan name exposed",
    planName ?? "not exposed by the ID token, access token or model list",
  ]);
  return finish(null);

  function finish(stopReason) {
    facts.unshift(
      ["probe version", PROBE_VERSION],
      ["total time (s)", ((clock() - runStart) / 1000).toFixed(1)],
      [
        "inference requests sent",
        `${inference.used} of at most ${maxInference}`,
      ],
    );
    if (stopReason) facts.push(["stopped early", stopReason]);
    return { rows, facts, reading: deriveReading(rows) };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function defaultHome() {
  return (
    process.env.SIWC_PROBE_HOME || path.join(os.homedir(), ".colony-siwc-probe")
  );
}

async function main() {
  const guard = checkOwnerRun({ env: process.env, stdin: process.stdin });
  if (!guard.ok) {
    process.stderr.write(`${guard.reason}\n`);
    process.exit(2);
  }
  if (!nodeIsSupported()) {
    process.stderr.write("This probe needs Node 20 or newer.\n");
    process.exit(2);
  }
  const registry = new SecretRegistry();
  const say = (line) =>
    process.stdout.write(`${sanitizeText(line, registry, 240)}\n`);

  sweepStaleScratch();
  const scratch = createScratch();
  installCleanupHandlers(scratch);
  const client = createHttp();
  try {
    const host = loadOrCreateHostId(defaultHome());
    say(
      `Host id ${host.created ? "created" : "reused"} (not a secret). Scratch folder is removed when the probe ends.`,
    );
    const report = await runProbe({
      client,
      registry,
      scratch,
      hostId: host.id,
      openBrowser: openInBrowser,
      enterSignal: () => waitForEnter(process.stdin),
      say,
      // Deliberate raw write: the owner may need to paste this address into a browser.
      printUrl: (url) =>
        process.stdout.write(
          `\nIf your browser did not open, paste this address into it:\n${url}\n\n`,
        ),
    });
    process.stdout.write("\n=== PASTE EVERYTHING BELOW THIS LINE BACK ===\n");
    process.stdout.write(`${renderReport(report, registry)}\n`);
    process.stdout.write("=== END ===\n");
  } catch (error) {
    process.stderr.write(
      `Probe stopped: ${sanitizeText(errorLabel(error), registry)}\n`,
    );
    process.exitCode = 1;
  } finally {
    const gone = scratch.removeSync();
    process.stdout.write(
      gone
        ? "Scratch folder removed. No tokens remain on disk.\n"
        : "WARNING: scratch folder could not be removed.\n",
    );
    process.stdin.pause();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
