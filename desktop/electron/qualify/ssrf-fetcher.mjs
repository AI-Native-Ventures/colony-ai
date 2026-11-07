import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const QUALIFY_USER_AGENT = "Colony-Qualify/1.0";
export const MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_REQUEST_MS = 8_000;
export const MAX_REDIRECTS = 4;

/** A bounded fetch failure that callers can turn into an honest observation state. */
export class QualifyFetchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "QualifyFetchError";
    this.code = code;
  }
}

function ipv4Parts(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numeric = parts.map((part) => Number(part));
  if (
    numeric.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return numeric;
}

function ipv4FromInteger(value) {
  return [
    Math.floor(value / 2 ** 24) % 256,
    Math.floor(value / 2 ** 16) % 256,
    Math.floor(value / 2 ** 8) % 256,
    value % 256,
  ];
}

function isPublicIpv4Parts([first, second, third]) {
  if (first === 0 || first === 10 || first === 127 || first >= 224)
    return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 192 && second === 0 && third === 0) return false;
  if (first === 192 && second === 0 && third === 2) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 198 && second === 51 && third === 100) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  return true;
}

function expandIpv6(address) {
  let value = address.toLocaleLowerCase().replace(/^\[|\]$/g, "");
  if (value.includes("%")) return null;
  const dot = value.lastIndexOf(".");
  if (dot !== -1) {
    const colon = value.lastIndexOf(":");
    if (colon === -1) return null;
    const parts = ipv4Parts(value.slice(colon + 1));
    if (!parts) return null;
    value = `${value.slice(0, colon)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const split = value.split("::");
  if (split.length > 2) return null;
  const left = split[0] ? split[0].split(":") : [];
  const right = split.length === 2 && split[1] ? split[1].split(":") : [];
  if (
    left.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
    right.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
    left.length + right.length > 8 ||
    (split.length === 1 && left.length !== 8)
  ) {
    return null;
  }
  return [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ];
}

function ipv6Value(address) {
  const parts = expandIpv6(address);
  if (!parts) return null;
  return BigInt(`0x${parts.map((part) => part.padStart(4, "0")).join("")}`);
}

function ipv6HasPrefix(value, prefix, bits) {
  const shift = 128n - BigInt(bits);
  return value >> shift === prefix >> shift;
}

/** Return true only for unicast addresses that a website fetcher may contact. */
export function isPublicAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "");
  if (net.isIP(normalized) === 4) {
    const parts = ipv4Parts(normalized);
    return parts ? isPublicIpv4Parts(parts) : false;
  }
  if (net.isIP(normalized) !== 6) return false;
  const value = ipv6Value(normalized);
  if (value === null || value === 0n || value === 1n) return false;
  if (ipv6HasPrefix(value, 0xfc00n << 112n, 7)) return false;
  if (ipv6HasPrefix(value, 0xfe80n << 112n, 10)) return false;
  if (ipv6HasPrefix(value, 0xff00n << 112n, 8)) return false;

  // IPv4-mapped and IPv4-compatible IPv6 forms inherit the IPv4 policy.
  const high = value >> 32n;
  if (high === 0xffffn || high === 0n) {
    return isPublicIpv4Parts(ipv4FromInteger(Number(value & 0xffffffffn)));
  }
  return true;
}

function hostnameForDns(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Parse and constrain a public website URL before it reaches DNS. */
export function parseQualifyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new QualifyFetchError("invalid_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  ) {
    throw new QualifyFetchError("invalid_url");
  }
  const literalHost = hostnameForDns(url);
  if (net.isIP(literalHost) && !isPublicAddress(literalHost)) {
    throw new QualifyFetchError("blocked_address");
  }
  return url;
}

async function defaultResolve(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

/** Resolve every address yourself and reject a hostname with any private answer. */
export async function resolvePublicHost(
  url,
  { resolve = defaultResolve } = {},
) {
  const hostname = hostnameForDns(url);
  const literalFamily = net.isIP(hostname);
  const entries = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new QualifyFetchError("dns_failure");
  }
  const valid = entries.every(
    (entry) =>
      entry &&
      (entry.family === 4 || entry.family === 6) &&
      typeof entry.address === "string" &&
      isPublicAddress(entry.address),
  );
  if (!valid) throw new QualifyFetchError("blocked_address");
  const first = entries[0];
  return { address: first.address, family: first.family };
}

function abortError(signal) {
  const reason = signal?.reason;
  return reason instanceof QualifyFetchError
    ? reason
    : new QualifyFetchError("cancelled");
}

async function withTimeout(run, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortError(parentSignal));
  if (parentSignal?.aborted) onAbort();
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new QualifyFetchError("timeout")),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

function remainingRequestMs(startedAt, timeoutMs) {
  const remaining = timeoutMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new QualifyFetchError("timeout");
  return remaining;
}

function defaultRequest({ url, address, signal }) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? https.request : http.request;
    const hostname = hostnameForDns(url);
    const options = {
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      signal,
      servername: url.protocol === "https:" ? hostname : undefined,
      headers: {
        Accept: "text/html, text/plain;q=0.9",
        "User-Agent": QUALIFY_USER_AGENT,
        Host: url.host,
      },
      lookup: (lookupHost, _options, callback) => {
        if (lookupHost !== hostname) {
          callback(new QualifyFetchError("dns_rebinding"));
          return;
        }
        callback(null, address.address, address.family);
      },
    };
    const requestHandle = request(options, (response) => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
      });
    });
    requestHandle.once("error", (error) => {
      if (signal?.aborted) reject(abortError(signal));
      else reject(error);
    });
    requestHandle.end();
  });
}

function contentType(headers) {
  const value = headers?.["content-type"] ?? headers?.["Content-Type"];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string"
    ? first.split(";", 1)[0].trim().toLocaleLowerCase()
    : "";
}

function contentLength(headers) {
  const value = headers?.["content-length"] ?? headers?.["Content-Length"];
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = typeof first === "string" ? Number(first) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBody(response, maxBytes, signal) {
  const type = contentType(response.headers);
  if (type !== "text/html" && type !== "text/plain") {
    throw new QualifyFetchError("unsupported_content_type");
  }
  const declared = contentLength(response.headers);
  if (declared !== null && declared > maxBytes) {
    response.body?.destroy?.();
    throw new QualifyFetchError("body_too_large");
  }
  if (
    !response.body ||
    typeof response.body[Symbol.asyncIterator] !== "function"
  ) {
    throw new QualifyFetchError("invalid_response");
  }
  const onAbort = () => response.body.destroy?.(abortError(signal));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const next = Buffer.from(chunk);
      bytes += next.length;
      if (bytes > maxBytes) {
        response.body.destroy?.();
        throw new QualifyFetchError("body_too_large");
      }
      chunks.push(next);
    }
    if (signal?.aborted) throw abortError(signal);
    return { text: Buffer.concat(chunks).toString("utf8"), contentType: type };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function redirectUrl(location, current) {
  try {
    return parseQualifyUrl(new URL(location, current).toString());
  } catch (error) {
    if (error instanceof QualifyFetchError) throw error;
    throw new QualifyFetchError("invalid_redirect");
  }
}

function classifyRequestError(error) {
  if (error instanceof QualifyFetchError) return error;
  const code = error && typeof error === "object" ? error.code : undefined;
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID"
  ) {
    return new QualifyFetchError("site_down");
  }
  return new QualifyFetchError("request_failed");
}

/**
 * Fetch one public HTML or plain-text page with DNS pinning and checked redirects.
 * The returned page has no cookies, credentials, proxy configuration, or JavaScript.
 */
export async function fetchQualifyPage(input, dependencies = {}) {
  const {
    resolve = defaultResolve,
    request = defaultRequest,
    requestTimeoutMs = MAX_REQUEST_MS,
    maxBytes = MAX_PAGE_BYTES,
    signal,
    allowNotFound = false,
  } = dependencies;
  let url = parseQualifyUrl(input);
  let redirects = 0;
  let downgradedFromHttps = false;
  while (true) {
    if (signal?.aborted) throw abortError(signal);
    let address;
    let response;
    const requestStartedAt = Date.now();
    try {
      address = await withTimeout(
        () => resolvePublicHost(url, { resolve }),
        remainingRequestMs(requestStartedAt, requestTimeoutMs),
        signal,
      );
      response = await withTimeout(
        (requestSignal) => request({ url, address, signal: requestSignal }),
        remainingRequestMs(requestStartedAt, requestTimeoutMs),
        signal,
      );
    } catch (error) {
      throw classifyRequestError(error);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.location ?? response.headers?.Location;
      const target = Array.isArray(location) ? location[0] : location;
      response.body?.destroy?.();
      if (!target || typeof target !== "string") {
        throw new QualifyFetchError("invalid_redirect");
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new QualifyFetchError("too_many_redirects");
      }
      const next = redirectUrl(target, url);
      if (url.protocol === "https:" && next.protocol === "http:") {
        downgradedFromHttps = true;
      }
      url = next;
      redirects += 1;
      continue;
    }
    if (response.status >= 500) throw new QualifyFetchError("site_down");
    if (response.status === 404 && allowNotFound) {
      response.body?.destroy?.();
      return {
        url: url.toString(),
        finalProtocol: url.protocol,
        downgradedFromHttps,
        text: "",
        contentType: "text/plain",
      };
    }
    if (response.status < 200 || response.status >= 300) {
      throw new QualifyFetchError("http_status");
    }
    const body = await withTimeout(
      (requestSignal) => readBody(response, maxBytes, requestSignal),
      remainingRequestMs(requestStartedAt, requestTimeoutMs),
      signal,
    ).catch((error) => {
      throw classifyRequestError(error);
    });
    return {
      url: url.toString(),
      finalProtocol: url.protocol,
      downgradedFromHttps,
      ...body,
    };
  }
}

/** Parse the small robots subset needed to decide whether a path may be fetched. */
export function robotsAllows(robotsText, path, userAgent = QUALIFY_USER_AGENT) {
  const groups = [];
  let agents = [];
  let rules = [];
  const finish = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of String(robotsText).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLocaleLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rules.length > 0) finish();
      agents.push(value.toLocaleLowerCase());
      continue;
    }
    if ((key === "allow" || key === "disallow") && agents.length > 0 && value) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  finish();
  const agent = userAgent.toLocaleLowerCase();
  const candidateLengths = groups.flatMap((group) =>
    group.agents
      .filter((candidate) => candidate === "*" || agent.startsWith(candidate))
      .map((candidate) => (candidate === "*" ? 0 : candidate.length)),
  );
  const longestAgent =
    candidateLengths.length > 0 ? Math.max(...candidateLengths) : -1;
  const applicable = groups.filter((group) =>
    group.agents.some(
      (candidate) =>
        (candidate === "*"
          ? 0
          : agent.startsWith(candidate)
            ? candidate.length
            : -1) === longestAgent,
    ),
  );
  const matchedRules = applicable
    .flatMap((group) => group.rules)
    .filter((rule) => path.startsWith(rule.path));
  if (matchedRules.length === 0) return true;
  const longest = Math.max(...matchedRules.map((rule) => rule.path.length));
  return matchedRules.some(
    (rule) => rule.path.length === longest && rule.allow,
  );
}
