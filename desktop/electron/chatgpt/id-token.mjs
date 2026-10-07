import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { ChatGptError, ISSUER } from "./policy.mjs";

/** Compare bounded secret strings without a content-dependent comparison. */
export function equalSecret(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.length <= 65536 &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

/** Validate discovery origins and pinned issuer before any token-bearing request. */
export function validateDiscovery(document, auth) {
  if (document?.issuer !== ISSUER) throw new ChatGptError("invalid_issuer");
  for (const key of ["jwks_uri", "revocation_endpoint"]) {
    let url;
    try {
      url = new URL(document[key]);
    } catch {
      throw new ChatGptError("invalid_discovery");
    }
    if (
      url.origin !== auth ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new ChatGptError("invalid_discovery");
  }
  if (!document.id_token_signing_alg_values_supported?.includes("RS256"))
    throw new ChatGptError("unsupported_algorithm");
  return document;
}

/** Verify RS256 and OIDC identity; JWKS refresh is bounded and single-flight. */
export function createIdTokenValidator({ policy, request, now = Date.now }) {
  let discovery;
  let keys;
  let fetchedAt = -Infinity;
  let flight;
  async function load(force = false) {
    if (flight) return flight;
    if (keys && !force && now() - fetchedAt < 3600_000) return;
    flight = (async () => {
      discovery = validateDiscovery(
        await request(`${policy.auth}/.well-known/openid-configuration`),
        policy.auth,
      );
      const data = await request(discovery.jwks_uri);
      if (!Array.isArray(data?.keys) || data.keys.length > 32)
        throw new ChatGptError("invalid_jwks");
      keys = data.keys;
      fetchedAt = now();
    })();
    try {
      await flight;
    } finally {
      flight = null;
    }
  }
  async function validate(token, { clientId, nonce, subject }) {
    let header;
    let claims;
    let parts;
    try {
      if (typeof token !== "string" || token.length > 65536) throw new Error();
      parts = token.split(".");
      if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
        throw new Error();
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      throw new ChatGptError("invalid_id_token");
    }
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit)
      throw new ChatGptError("unsupported_algorithm");
    await load();
    let key = keys.find((k) => k.kid === header.kid);
    if (!key && now() - fetchedAt >= 30_000) {
      await load(true);
      key = keys.find((k) => k.kid === header.kid);
    }
    if (
      key?.kty !== "RSA" ||
      (key.alg && key.alg !== "RS256") ||
      (key.use && key.use !== "sig")
    )
      throw new ChatGptError("invalid_signature");
    try {
      if (
        !verify(
          "RSA-SHA256",
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key, format: "jwk" }),
          Buffer.from(parts[2], "base64url"),
        )
      )
        throw new Error();
    } catch {
      throw new ChatGptError("invalid_signature");
    }
    const seconds = now() / 1000;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER) throw new ChatGptError("invalid_issuer");
    if (
      !audience.includes(clientId) ||
      (audience.length > 1 && claims.azp !== clientId) ||
      (claims.azp && claims.azp !== clientId)
    )
      throw new ChatGptError("invalid_audience");
    if (
      !Number.isFinite(claims.exp) ||
      claims.exp <= seconds - 5 ||
      (claims.nbf !== undefined &&
        (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 5)) ||
      !Number.isFinite(claims.iat) ||
      claims.iat > seconds + 5
    )
      throw new ChatGptError("invalid_expiry");
    if (nonce !== undefined && !equalSecret(claims.nonce, nonce))
      throw new ChatGptError("invalid_nonce");
    if (
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 512 ||
      (subject && claims.sub !== subject)
    )
      throw new ChatGptError("identity_mismatch");
    return {
      subject: claims.sub,
      email:
        typeof claims.email === "string" && claims.email.length <= 320
          ? claims.email
          : null,
    };
  }
  return {
    validate,
    discovery: async () => {
      await load();
      return discovery;
    },
  };
}
