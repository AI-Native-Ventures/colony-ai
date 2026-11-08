const PROVIDERS = Object.freeze(["codex", "claude"]);
const FRESH_USAGE_MS = 5 * 60 * 1000;

const PROVIDER_SOURCES = {
  claude: new Set(["claude-code", "colony-token-counts"]),
  codex: new Set(["codex-app-server", "colony-token-counts"]),
};

/** Text shown when Colony has no supported, safe plan-usage reader. */
export const AI_PLAN_USAGE_UNAVAILABLE_MESSAGE =
  "usage not available for your AI";

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new TypeError("Unknown AI plan provider.");
  }
}

function assertNow(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("AI plan usage requires a valid observation time.");
  }
  return value;
}

function unavailable(provider, observedAt) {
  return {
    provider,
    availability: "unavailable",
    usedPercent: null,
    resetAt: null,
    source: "unavailable",
    observedAt,
    freshness: "unavailable",
    confidence: null,
    message: AI_PLAN_USAGE_UNAVAILABLE_MESSAGE,
  };
}

function isUsablePercent(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function hasSupportedConfidence(source, confidence) {
  return (
    ["reported", "estimated"].includes(confidence) &&
    (source !== "colony-token-counts" || confidence === "estimated")
  );
}

/**
 * Normalize a provider-owned usage snapshot without exposing credentials.
 * Times are epoch milliseconds. Invalid input becomes an honest unavailable
 * snapshot so a malformed provider response cannot create a false reserve.
 */
export function normalizeAiPlanUsage(
  provider,
  candidate,
  { now = Date.now() } = {},
) {
  assertProvider(provider);
  const observedAt = assertNow(now);
  if (!candidate || typeof candidate !== "object") {
    return unavailable(provider, observedAt);
  }
  const source = candidate.source;
  const candidateObservedAt = candidate.observedAt;
  const resetAt = candidate.resetAt;
  if (
    !PROVIDER_SOURCES[provider].has(source) ||
    !isUsablePercent(candidate.usedPercent) ||
    !Number.isSafeInteger(candidateObservedAt) ||
    candidateObservedAt < 0 ||
    candidateObservedAt > observedAt ||
    !Number.isSafeInteger(resetAt) ||
    resetAt <= candidateObservedAt ||
    !hasSupportedConfidence(source, candidate.confidence)
  ) {
    return unavailable(provider, observedAt);
  }
  return {
    provider,
    availability: "available",
    usedPercent: candidate.usedPercent,
    resetAt,
    source,
    observedAt: candidateObservedAt,
    freshness:
      observedAt - candidateObservedAt <= FRESH_USAGE_MS ? "fresh" : "stale",
    confidence: candidate.confidence,
    message: null,
  };
}

/**
 * Read every provider through the currently supported desktop-safe surface.
 * Neither provider exposes a supported reader under Colony's credential rules,
 * so this deliberately performs no file, keychain, process, or network I/O.
 */
export function readAiPlanUsage({ now = Date.now } = {}) {
  const observedAt = assertNow(now());
  return PROVIDERS.map((provider) => unavailable(provider, observedAt));
}
