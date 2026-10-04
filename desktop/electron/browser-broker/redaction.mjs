/**
 * Credential redaction and untrusted text handling for the agent browser.
 * Pure functions. Everything that leaves the broker toward an agent, the UI
 * log or disk goes through here.
 */

export const REDACTED = "[redacted]";
export const MAX_REDACTED_STRING = 2_000;
const MAX_SCAN_LENGTH = 100_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_DEPTH = 6;
const MAX_KEYS = 60;

const SENSITIVE_KEY =
  /(pass(word|wd|phrase|code)?|pwd|secret|token|credential|cookie|authorization|auth[_-]?header|api[_-]?key|apikey|private[_-]?key|nsec|session|csrf|xsrf|signature|cvv|cvc|card[_-]?number|otp|pin)$/iu;

const SENSITIVE_PARAM =
  /^(access[_-]?token|refresh[_-]?token|id[_-]?token|token|code|state|key|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|pass|auth|authorization|sig|signature|session|sessionid|sid|jwt|bearer|otp|csrf|xsrf|nonce|assertion|saml(response|request)|ticket)$/iu;

// Order matters: specific shapes first so the key=value rule does not eat them.
const SECRET_PATTERNS = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  ],
  [/\bnsec1[02-9ac-hj-np-z]{40,}/gu],
  [/\bey[A-Za-z0-9_-]{8,}\.ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer "],
  [/\bBasic\s+[A-Za-z0-9+/=]{12,}/gu, "Basic "],
  [/\bAKIA[0-9A-Z]{16}\b/gu],
  [/\bASIA[0-9A-Z]{16}\b/gu],
  [/\bsk-(?:ant-|proj-|live-|or-)?[A-Za-z0-9_-]{20,}/gu],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/gu],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/gu],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/gu],
  [/\bAIza[0-9A-Za-z_-]{35}/gu],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/gu],
  [/\bglpat-[A-Za-z0-9_-]{20,}/gu],
  [/\bnpm_[A-Za-z0-9]{30,}/gu],
];

const KEY_VALUE =
  /\b(pass(?:word|wd|phrase|code)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|authorization|session(?:id)?|csrf|otp|cvv|cvc)\b(\s*["']?\s*[:=]\s*["']?)(?:((?:Bearer|Basic)\s+)|(?!(?:Bearer|Basic)\s))(?!\[redacted\])([^\s"'&;,]{3,})/giu;

/** Luhn check for payment card style numbers. */
export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/gu;

function redactCards(text) {
  return text.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/gu, "");
    if (digits.length < 13 || digits.length > 19) return match;
    return luhnValid(digits) ? REDACTED : match;
  });
}

function scrub(text) {
  let result = text;
  for (const [pattern, keep] of SECRET_PATTERNS)
    result = result.replace(pattern, keep ? `${keep}${REDACTED}` : REDACTED);
  result = result.replace(
    KEY_VALUE,
    (_match, key, separator, scheme) =>
      `${key}${separator}${scheme ?? ""}${REDACTED}`,
  );
  return redactCards(result);
}

/** True when the text contains something that looks like a secret. */
export function containsSecret(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return (
    scrub(text.slice(0, MAX_SCAN_LENGTH)) !== text.slice(0, MAX_SCAN_LENGTH)
  );
}

/** Replace secrets inside free text, then bound its length. Idempotent. */
export function redactText(text, maxLength = MAX_REDACTED_STRING) {
  if (typeof text !== "string") return "";
  const result = scrub(text.slice(0, Math.max(maxLength * 4, maxLength + 1)));
  return result.length > maxLength
    ? `${result.slice(0, maxLength)}...`
    : result;
}

const TOKENISH_SEGMENT = /^[A-Za-z0-9_-]{32,}$/u;

/**
 * Strip credentials from a URL: userinfo, sensitive query and fragment
 * parameters and token looking path segments. Returns "" for non URLs.
 */
export function redactUrl(input) {
  if (typeof input !== "string") return "";
  let url;
  try {
    url = new URL(input);
  } catch {
    return redactText(input, 300);
  }
  url.username = "";
  url.password = "";
  const scrubParams = (params) =>
    new URLSearchParams(
      [...params.entries()].map(([key, value]) => [
        key,
        SENSITIVE_PARAM.test(key) ? REDACTED : redactText(value, 200),
      ]),
    );
  if (url.search.length > 1)
    url.search = scrubParams(url.searchParams).toString();
  if (url.hash.length > 1 && url.hash.includes("=")) {
    url.hash = scrubParams(new URLSearchParams(url.hash.slice(1))).toString();
  } else if (url.hash.length > 1) {
    url.hash = redactText(url.hash.slice(1), 100);
  }
  url.pathname = url.pathname
    .split("/")
    .map((segment) => (TOKENISH_SEGMENT.test(segment) ? REDACTED : segment))
    .join("/");
  const text = url.href.replaceAll(encodeURIComponent(REDACTED), REDACTED);
  return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
}

/**
 * Deep redaction of a log or event record. Keys that look like secrets lose
 * their value. Bounded in depth, breadth and string length so an adversarial
 * page cannot blow up the log.
 */
export function redactRecord(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactRecord(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (count >= MAX_KEYS) break;
      count += 1;
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
      } else if (/^(url|href|origin|location|referrer|referer)$/iu.test(key)) {
        out[key] = redactUrl(typeof item === "string" ? item : "");
      } else {
        out[key] = redactRecord(item, depth + 1);
      }
    }
    return out;
  }
  return String(value).slice(0, 100);
}

// Invisible characters used to smuggle instructions past a reader:
// zero width, bidi controls, soft hyphen, word joiner, BOM and the Unicode
// "tag" block (U+E0000 to U+E007F).
const INVISIBLE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: stripping combining and invisible code points is the point
  /[\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;

/**
 * Normalize text that came from a web page before it is shown to an agent or
 * written to a log: strip control and invisible characters and collapse
 * whitespace. Does NOT make the text trustworthy; see `wrapUntrusted`.
 */
export function sanitizeUntrusted(text, maxLength = 160) {
  if (typeof text !== "string") return "";
  const cleaned = text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, Math.max(0, maxLength - 3))}...`
    : cleaned;
}

/**
 * Wrap page derived text in an envelope that tells the agent it is data. A
 * page cannot close the envelope early: any closing tag inside is neutralized.
 */
export function wrapUntrusted(text, { origin, tab } = {}) {
  const body = String(text).replace(
    /<\s*\/\s*untrusted-page-content/giu,
    "<\\/untrusted-page-content",
  );
  const attr = (value) =>
    String(value ?? "")
      .replace(/[^\w.:/@-]/gu, "")
      .slice(0, 300);
  return `<untrusted-page-content origin="${attr(origin)}" tab="${attr(tab)}">\n${body}\n</untrusted-page-content>`;
}

/**
 * Like `sanitizeUntrusted` but keeps line structure, for multi line page text.
 * Strips control and invisible characters, trims lines, collapses runs of
 * blank lines, redacts secrets and bounds the length.
 */
export function sanitizeBlock(text, maxLength = 8_000) {
  if (typeof text !== "string") return { text: "", truncated: false };
  const cleaned = text
    .slice(0, maxLength * 4)
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONTROLS, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const redacted = redactText(cleaned, maxLength * 4);
  const truncated = redacted.length > maxLength;
  return {
    text: truncated ? `${redacted.slice(0, maxLength)}...` : redacted,
    truncated,
  };
}
