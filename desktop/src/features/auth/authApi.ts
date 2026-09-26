import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_AUTH_REQUEST_BYTES = 64 * 1024;

/** Stable failure codes exposed to the account UI. */
export type AuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_unverified"
  | "email_taken"
  | "identity_taken"
  | "code_expired"
  | "wrong_code"
  | "too_many_attempts"
  | "resend_cooldown"
  | "weak_password"
  | "rate_limited"
  | "account_not_found"
  | "server_error"
  | "invalid_response"
  | "network_error"
  | "insecure_transport"
  | "invalid_relay_url"
  | "identity_unavailable"
  | "identity_changed"
  | "account_state_changed"
  | "identity_import_failed"
  | "google_sign_in_unavailable"
  | "google_sign_in_failed";

/** A safe, typed failure. Raw relay response bodies are never attached. */
export class AuthApiError extends Error {
  readonly code: AuthErrorCode;
  readonly status?: number;
  readonly retryAfterSecs?: number;
  readonly remainingAttempts?: number;

  constructor(
    code: AuthErrorCode,
    options: {
      status?: number;
      retryAfterSecs?: number;
      remainingAttempts?: number;
    } = {},
  ) {
    super(code);
    this.name = "AuthApiError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSecs = options.retryAfterSecs;
    this.remainingAttempts = options.remainingAttempts;
  }
}

/** Account metadata returned by the relay, without any signing secret. */
export type AuthAccount = {
  id: string;
  email: string;
  pubkey: string;
  hasPassword: boolean;
  googleLinked: boolean;
};

/** Accepted response shared by verification and password reset code routes. */
export type VerificationSent = {
  status: "verification_sent";
  retryAfterSecs?: number;
};

/** Internal response shape consumed by the native identity importer. */
export type AuthSession = {
  account: AuthAccount;
  nsec: string;
};

/** Signs a NIP-98 event using the identity currently held by the native host. */
export type SignRelayEvent = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

export type AuthApiOptions = {
  baseUrl: string;
  signRelayEvent: SignRelayEvent;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export type AuthApi = ReturnType<typeof createAuthApi>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function normalizedBaseUrl(raw: string): URL {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new AuthApiError("invalid_relay_url");
  }

  if (base.username || base.password || base.search || base.hash) {
    throw new AuthApiError("invalid_relay_url");
  }
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && isLoopbackHost(base.hostname))
  ) {
    throw new AuthApiError("insecure_transport");
  }
  return base;
}

function endpointUrl(baseUrl: string, path: string): string {
  const base = normalizedBaseUrl(baseUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(path.replace(/^\//, ""), base).toString();
}

function asHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return asHex(new Uint8Array(digest));
}

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function accountFrom(value: unknown): AuthAccount {
  if (!isRecord(value)) throw new AuthApiError("invalid_response");
  const id = value.id;
  const email = value.email;
  const pubkey = value.pubkey;
  const hasPassword = value.has_password;
  const googleLinked = value.google_linked;
  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    typeof pubkey !== "string" ||
    typeof hasPassword !== "boolean" ||
    typeof googleLinked !== "boolean"
  ) {
    throw new AuthApiError("invalid_response");
  }
  return { id, email, pubkey, hasPassword, googleLinked };
}

function sessionFrom(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.nsec !== "string" || !value.nsec) {
    throw new AuthApiError("invalid_response");
  }
  // Keep the parsed response as the session object so the service can blank
  // its nsec field before handing the value to the native importer.
  value.account = accountFrom(value.account);
  return value as unknown as AuthSession;
}

function verificationSentFrom(value: unknown): VerificationSent {
  if (!isRecord(value) || value.status !== "verification_sent") {
    throw new AuthApiError("invalid_response");
  }
  const cooldown = retryAfter(value);
  return {
    status: "verification_sent",
    ...(cooldown === undefined ? {} : { retryAfterSecs: cooldown }),
  };
}

function retryAfter(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const secs = value.retry_after_secs;
  return typeof secs === "number" && Number.isFinite(secs) && secs >= 0
    ? Math.floor(secs)
    : undefined;
}

function remainingAttempts(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const attempts = value.attempts_left ?? value.remaining_attempts;
  return typeof attempts === "number" &&
    Number.isFinite(attempts) &&
    attempts >= 0
    ? Math.floor(attempts)
    : undefined;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_AUTH_RESPONSE_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new AuthApiError("invalid_response");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_AUTH_RESPONSE_BYTES) {
        value.fill(0);
        await reader.cancel().catch(() => undefined);
        throw new AuthApiError("invalid_response");
      }
      chunks.push(value);
    }
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    if (error instanceof AuthApiError) throw error;
    throw new AuthApiError("network_error");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    chunk.fill(0);
  }
  let text = "";
  try {
    text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  } finally {
    text = "";
    bytes.fill(0);
  }
}

function errorFromResponse(status: number, value: unknown): AuthApiError {
  const serverCode = isRecord(value) ? value.error : undefined;
  if (status === 429) {
    const code: AuthErrorCode =
      serverCode === "too_many_attempts" || serverCode === "resend_cooldown"
        ? serverCode
        : "rate_limited";
    return new AuthApiError(code, {
      status,
      retryAfterSecs: retryAfter(value),
      remainingAttempts: remainingAttempts(value),
    });
  }
  if (status === 404 && serverCode === "account_not_found") {
    return new AuthApiError("account_not_found", { status });
  }
  if (status === 400 && serverCode === "invalid_request") {
    return new AuthApiError("invalid_request", { status });
  }
  if (status === 401 && serverCode === "invalid_credentials") {
    return new AuthApiError("invalid_credentials", {
      status,
      remainingAttempts: remainingAttempts(value),
    });
  }
  if (status === 403 && serverCode === "email_unverified") {
    return new AuthApiError("email_unverified", { status });
  }
  if (status === 409 && serverCode === "email_taken") {
    return new AuthApiError("email_taken", { status });
  }
  if (status === 409 && serverCode === "identity_taken") {
    return new AuthApiError("identity_taken", { status });
  }
  if (status === 410 && serverCode === "code_expired") {
    return new AuthApiError("code_expired", { status });
  }
  if (status === 422 && serverCode === "weak_password") {
    return new AuthApiError("weak_password", { status });
  }
  if (status === 422 && serverCode === "wrong_code") {
    return new AuthApiError("wrong_code", {
      status,
      remainingAttempts: remainingAttempts(value),
    });
  }
  return new AuthApiError("server_error", { status });
}

function signedHeader(event: RelayEvent): string {
  return `Nostr ${base64Json(event)}`;
}

/**
 * Create a typed client for every email/password and Google account route.
 * A 429 is returned as a typed failure with the server's retry delay. The
 * client does not replay account-changing POSTs automatically.
 */
export function createAuthApi(options: AuthApiOptions) {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function request(
    method: string,
    path: string,
    body?: unknown,
    signed = false,
    expectedPubkey?: string,
  ): Promise<{ status: number; body: unknown }> {
    const url = endpointUrl(options.baseUrl, path);
    let bodyText = body === undefined ? undefined : JSON.stringify(body);
    try {
      if (
        bodyText !== undefined &&
        new TextEncoder().encode(bodyText).byteLength > MAX_AUTH_REQUEST_BYTES
      ) {
        throw new AuthApiError("invalid_request");
      }
      const headers: Record<string, string> = {};
      if (bodyText !== undefined) headers["Content-Type"] = "application/json";
      if (signed) {
        const tags = [
          ["u", url],
          ["method", method],
        ];
        if (bodyText !== undefined) {
          tags.push(["payload", await sha256Hex(bodyText)]);
        }
        tags.push(["nonce", crypto.randomUUID()]);
        let event: RelayEvent;
        try {
          event = await options.signRelayEvent({
            kind: NIP98_KIND,
            content: "",
            tags,
          });
        } catch {
          throw new AuthApiError("identity_unavailable");
        }
        if (
          expectedPubkey &&
          event.pubkey.toLowerCase() !== expectedPubkey.toLowerCase()
        ) {
          throw new AuthApiError("identity_changed");
        }
        headers.Authorization = signedHeader(event);
      }

      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers,
          body: bodyText,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new AuthApiError("network_error");
      }
      let responseBody: unknown;
      if (response.status !== 204) {
        responseBody = await readJsonResponse(response);
      }
      if (!response.ok) {
        throw errorFromResponse(response.status, responseBody);
      }
      return { status: response.status, body: responseBody };
    } finally {
      // Passwords, ID tokens, and claim nsecs are not retained by the client.
      bodyText = "";
    }
  }

  async function expectStatus(
    result: Promise<{ status: number; body: unknown }>,
    status: number,
  ): Promise<unknown> {
    const response = await result;
    if (response.status !== status) {
      throw new AuthApiError("invalid_response", { status: response.status });
    }
    return response.body;
  }

  return {
    async signUp(
      email: string,
      password: string,
      displayName?: string,
    ): Promise<VerificationSent> {
      const requestBody =
        displayName === undefined
          ? { email, password }
          : { email, password, display_name: displayName };
      const body = await expectStatus(
        request("POST", "/api/accounts/signup", requestBody),
        202,
      );
      return verificationSentFrom(body);
    },

    async verifyEmail(email: string, code: string): Promise<AuthSession> {
      const body = await expectStatus(
        request("POST", "/api/accounts/verify", { email, code }),
        200,
      );
      return sessionFrom(body);
    },

    async resendCode(
      email: string,
      purpose: "verify" | "reset",
    ): Promise<VerificationSent> {
      const body = await expectStatus(
        request("POST", "/api/accounts/resend-code", { email, purpose }),
        202,
      );
      return verificationSentFrom(body);
    },

    async signIn(email: string, password: string): Promise<AuthSession> {
      const body = await expectStatus(
        request("POST", "/api/accounts/signin", { email, password }),
        200,
      );
      return sessionFrom(body);
    },

    async signInWithGoogle(idToken: string): Promise<AuthSession> {
      const body = await expectStatus(
        request("POST", "/api/accounts/google", { id_token: idToken }),
        200,
      );
      return sessionFrom(body);
    },

    async requestReset(email: string): Promise<VerificationSent> {
      const body = await expectStatus(
        request("POST", "/api/accounts/reset/request", { email }),
        202,
      );
      return verificationSentFrom(body);
    },

    async checkResetCode(email: string, code: string): Promise<void> {
      const body = await expectStatus(
        request("POST", "/api/accounts/reset/check", { email, code }),
        200,
      );
      if (!isRecord(body) || body.status !== "code_valid") {
        throw new AuthApiError("invalid_response");
      }
    },

    async confirmReset(
      email: string,
      code: string,
      newPassword: string,
    ): Promise<AuthSession> {
      const body = await expectStatus(
        request("POST", "/api/accounts/reset/confirm", {
          email,
          code,
          new_password: newPassword,
        }),
        200,
      );
      return sessionFrom(body);
    },

    async claimAccount(
      email: string,
      password: string,
      nsec: string,
      expectedPubkey: string,
    ): Promise<VerificationSent> {
      const body = await expectStatus(
        request(
          "POST",
          "/api/accounts/claim",
          { email, password, nsec },
          true,
          expectedPubkey,
        ),
        202,
      );
      return verificationSentFrom(body);
    },

    async changePassword(
      newPassword: string,
      expectedPubkey: string,
    ): Promise<void> {
      await expectStatus(
        request(
          "POST",
          "/api/accounts/password",
          { new_password: newPassword },
          true,
          expectedPubkey,
        ),
        204,
      );
    },

    async getAccount(expectedPubkey: string): Promise<AuthAccount> {
      const body = await expectStatus(
        request("GET", "/api/accounts/me", undefined, true, expectedPubkey),
        200,
      );
      if (!isRecord(body)) throw new AuthApiError("invalid_response");
      return accountFrom(body.account);
    },

    async deleteAccount(expectedPubkey: string): Promise<void> {
      await expectStatus(
        request("DELETE", "/api/accounts/me", undefined, true, expectedPubkey),
        204,
      );
    },
  };
}
