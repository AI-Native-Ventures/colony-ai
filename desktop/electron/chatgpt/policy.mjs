export const CHATGPT_BUILD_CONFIG = Object.freeze({
  enabled: false,
  testBuild: false,
});
export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CALLBACK_PATH = "/auth/callback";
export const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

/** Errors contain only stable local codes, never remote text or tokens. */
export class ChatGptError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Resolve two test-only origin overrides without enabling production redirects. */
export function chatGptPolicy(env = {}, build = CHATGPT_BUILD_CONFIG) {
  const origin = (value, fallback) => {
    if (!build.testBuild || !value) return fallback;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new ChatGptError("invalid_test_origin");
    }
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      !parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new ChatGptError("invalid_test_origin");
    return parsed.origin;
  };
  const auth = origin(env.COLONY_CHATGPT_AUTH_ORIGIN, ISSUER);
  const api = origin(env.COLONY_CHATGPT_API_ORIGIN, "https://api.openai.com");
  return Object.freeze({
    enabled: env.COLONY_CHATGPT_PLAN === "1" || build.enabled === true,
    auth,
    api,
    resource: `${api}/v1`,
  });
}

/** Accept an issued registration, never the dynamic entrypoint or a path. */
export function validClientId(value) {
  return (
    typeof value === "string" && /^oaiapp_[A-Za-z0-9_-]{1,190}$/.test(value)
  );
}

export const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
