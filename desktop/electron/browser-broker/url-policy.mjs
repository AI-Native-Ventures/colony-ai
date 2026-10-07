import { isIP } from "node:net";
import dns from "node:dns";

/**
 * Pure network policy for agent browsing. Every function here is deterministic
 * given its inputs (the resolver is injected), so the whole file is covered by
 * node unit tests without a browser.
 *
 * Decision shape: `{ ok: true, ... }` or `{ ok: false, code, reason }` where
 * `code` is one of `invalid_input`, `scheme_denied`, `private_network_denied`
 * or `dns_failed`.
 */

export const MAX_AGENT_URL_LENGTH = 8_192;
const DEFAULT_PORTS = { "http:": 80, "https:": 443 };

// [base, prefix, reason, exceptionable]. An exceptionable range can be
// unlocked for one explicit host:port by the person. Everything else
// (link-local and cloud metadata, unspecified, multicast, reserved,
// documentation) can never be unlocked.
const V4_RANGES = [
  ["0.0.0.0", 8, "unspecified", false],
  ["10.0.0.0", 8, "private", true],
  ["100.64.0.0", 10, "shared-address-space", true],
  ["127.0.0.0", 8, "loopback", true],
  ["169.254.0.0", 16, "link-local", false],
  ["172.16.0.0", 12, "private", true],
  ["192.0.0.0", 24, "reserved", false],
  ["192.0.2.0", 24, "documentation", false],
  ["192.88.99.0", 24, "reserved", false],
  ["192.168.0.0", 16, "private", true],
  ["198.18.0.0", 15, "benchmarking", false],
  ["198.51.100.0", 24, "documentation", false],
  ["203.0.113.0", 24, "documentation", false],
  ["224.0.0.0", 4, "multicast", false],
  ["240.0.0.0", 4, "reserved", false],
].map(([base, prefix, reason, exceptionable]) => ({
  base: ipv4ToInt(parseIPv4(base)),
  mask: prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0,
  reason,
  exceptionable,
}));

const LOCAL_HOST_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home",
  "home.arpa",
  "localdomain",
  "intranet",
  "corp",
  "private",
];

const DENIED = (reason, exceptionable = false) => ({
  allowed: false,
  reason,
  exceptionable,
});
const PUBLIC = { allowed: true, reason: "public", exceptionable: false };

/** Strict dotted quad. Leading zeros are rejected (octal ambiguity). */
export function parseIPv4(text) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(text);
  if (!match) return null;
  const octets = [];
  for (const part of match.slice(1)) {
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function ipv4ToInt(octets) {
  return (
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  );
}

/** Returns 16 bytes, or null for anything that is not a plain IPv6 literal. */
export function parseIPv6(text) {
  if (typeof text !== "string" || text.includes("%")) return null;
  let source = text.toLowerCase();
  if (source.includes(".")) {
    const split = source.lastIndexOf(":");
    const v4 = parseIPv4(source.slice(split + 1));
    if (!v4) return null;
    source = `${source.slice(0, split + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part) => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  let groups;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    if (head.length + tail.length > 7) return null;
    groups = [
      ...head,
      ...new Array(8 - head.length - tail.length).fill("0"),
      ...tail,
    ];
  }
  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function classifyV4(octets) {
  const value = ipv4ToInt(octets);
  for (const range of V4_RANGES) {
    if ((value & range.mask) >>> 0 === range.base)
      return DENIED(range.reason, range.exceptionable);
  }
  return PUBLIC;
}

function classifyV6(bytes) {
  const allZeroPrefix = (count) => bytes.slice(0, count).every((b) => b === 0);
  if (allZeroPrefix(15)) {
    if (bytes[15] === 0) return DENIED("unspecified");
    if (bytes[15] === 1) return DENIED("loopback", true);
  }
  // IPv4-mapped ::ffff:a.b.c.d takes the verdict of the embedded address.
  if (allZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff)
    return classifyV4(bytes.slice(12));
  // IPv4-compatible (deprecated) addresses are never legitimate targets.
  if (allZeroPrefix(12)) return DENIED("reserved");
  // NAT64 well known prefix 64:ff9b::/96 translates to the embedded IPv4.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  )
    return classifyV4(bytes.slice(12));
  // 6to4 2002::/16 embeds an IPv4 at bytes 2 to 5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02)
    return classifyV4(bytes.slice(2, 6));
  if ((bytes[0] & 0xfe) === 0xfc) return DENIED("unique-local", true);
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)
    return DENIED("link-local");
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0)
    return DENIED("site-local");
  if (bytes[0] === 0xff) return DENIED("multicast");
  // Only global unicast 2000::/3 is a legitimate public destination.
  if ((bytes[0] & 0xe0) !== 0x20) return DENIED("reserved");
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    // 2001::/23 IETF protocol assignments (includes Teredo), 2001:db8::/32
    // documentation.
    if (bytes[2] <= 0x01) return DENIED("reserved");
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return DENIED("documentation");
  }
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0)
    return DENIED("documentation");
  return PUBLIC;
}

/**
 * Classify a resolver answer or an IP literal. Fails closed: anything that is
 * not a canonical IPv4 or IPv6 literal is denied.
 */
export function classifyIp(address) {
  if (typeof address !== "string") return DENIED("invalid-address");
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIPv4(address);
    return octets ? classifyV4(octets) : DENIED("invalid-address");
  }
  if (family === 6) {
    const bytes = parseIPv6(address);
    return bytes ? classifyV6(bytes) : DENIED("invalid-address");
  }
  return DENIED("invalid-address");
}

function classifyHostname(hostname) {
  if (!hostname.includes(".")) return DENIED("local-hostname", true);
  for (const suffix of LOCAL_HOST_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`))
      return DENIED("local-hostname", true);
  }
  return PUBLIC;
}

function failure(code, reason) {
  return { ok: false, code, reason };
}

function exceptionKey(hostname, port) {
  return `${hostname}:${port}`;
}

/** Normalize and validate an explicit private-network exception list. */
export function normalizePrivateExceptions(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error("Invalid private exceptions");
  const normalized = [];
  for (const entry of list) {
    if (typeof entry !== "string") throw new Error("Invalid private exception");
    const match = /^(\[[0-9a-fA-F:.]+\]|[^:\s/]+):(\d{1,5})$/u.exec(entry);
    if (!match) throw new Error("Invalid private exception");
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error("Invalid private exception");
    const host = match[1].replace(/^\[|\]$/gu, "").toLowerCase();
    normalized.push(exceptionKey(host, port));
  }
  return [...new Set(normalized)];
}

/**
 * Syntactic check of a URL an agent wants to open. No network access.
 * `needsResolution` tells the caller it must still resolve and pin the host.
 */
export function checkUrl(input, { privateExceptions = [] } = {}) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_AGENT_URL_LENGTH ||
    input !== input.trim() ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting controls is the point
    /[\u0000-\u001f\u007f]/u.test(input)
  )
    return failure("invalid_input", "Invalid URL");
  let url;
  try {
    url = new URL(input);
  } catch {
    return failure("invalid_input", "Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return failure(
      "scheme_denied",
      `Scheme ${url.protocol.replace(/:$/u, "")} is not allowed`,
    );
  if (url.username.length > 0 || url.password.length > 0)
    return failure("invalid_input", "Credentials in a URL are not allowed");
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]"))
    hostname = hostname.slice(1, -1);
  hostname = hostname.replace(/\.$/u, "");
  if (hostname.length === 0) return failure("invalid_input", "Invalid URL");
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol];
  const exceptions = new Set(normalizePrivateExceptions(privateExceptions));
  const exception = exceptions.has(exceptionKey(hostname, port));

  const literal = isIP(hostname) !== 0;
  const verdict = literal ? classifyIp(hostname) : classifyHostname(hostname);
  if (!verdict.allowed && !(exception && verdict.exceptionable))
    return failure(
      "private_network_denied",
      `Host is not a public internet address (${verdict.reason})`,
    );
  return {
    ok: true,
    url: url.href,
    origin: url.origin,
    protocol: url.protocol,
    hostname,
    port,
    ip: literal ? hostname : null,
    exception,
    needsResolution: !literal,
  };
}

/**
 * Check every answer of a resolution. One bad answer denies the whole host: a
 * mixed public and private answer is how DNS rebinding hides.
 */
export function checkAddresses(addresses, { exception = false } = {}) {
  if (!Array.isArray(addresses) || addresses.length === 0)
    return failure("dns_failed", "Host did not resolve");
  for (const entry of addresses) {
    const verdict = classifyIp(entry?.address);
    if (!verdict.allowed && !(exception && verdict.exceptionable))
      return failure(
        "private_network_denied",
        `Host resolves to a non-public address (${verdict.reason})`,
      );
  }
  return {
    ok: true,
    addresses: addresses.map(({ address, family }) => ({
      address,
      family: family ?? isIP(address),
    })),
  };
}

export const defaultResolver = async (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Resolve once and return the pinned, verified addresses. The egress proxy and
 * the navigation guard both connect to these literals so a second DNS answer
 * can never be used.
 */
export async function resolveAndPin(
  hostname,
  { resolver = defaultResolver, exception = false } = {},
) {
  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    return failure("dns_failed", "Host did not resolve");
  }
  return checkAddresses(addresses, { exception });
}

/** Full navigation guard: syntax, then resolve and pin when needed. */
export async function guardNavigation(
  input,
  { resolver = defaultResolver, privateExceptions = [] } = {},
) {
  const checked = checkUrl(input, { privateExceptions });
  if (!checked.ok) return checked;
  if (!checked.needsResolution) return { ...checked, pinned: [] };
  const pinned = await resolveAndPin(checked.hostname, {
    resolver,
    exception: checked.exception,
  });
  if (!pinned.ok) return pinned;
  return { ...checked, pinned: pinned.addresses };
}

/** Origin of an http(s) URL, or null. Never throws. */
export function originOf(input) {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin, allowedOrigins) {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}
