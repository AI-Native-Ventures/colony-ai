import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkedScopeId } from "../browser-host-policy.mjs";
import {
  checkUrl,
  normalizePrivateExceptions,
  originOf,
} from "./url-policy.mjs";

/**
 * Capability store for the agent browser. A grant is a short lived, revocable
 * bundle of rights created ONLY by the person (through the host UI): one
 * agent, one task, one business, specific tabs, exact origins, an expiry.
 * Pure given injected clocks and randomness.
 *
 * The raw bearer token is returned once by `issue` and never stored: only its
 * SHA-256 is kept. Nothing here reads page content.
 */

export const DEFAULT_GRANT_TTL_MS = 15 * 60_000;
export const MAX_GRANT_TTL_MS = 60 * 60_000;
export const MAX_EXTRA_TABS = 3;
export const MAX_ACTIVE_GRANTS = 32;
export const MAX_ALLOWED_ORIGINS = 32;
const MAX_ENDED_GRANTS = 64;

export class CapabilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
  }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function checkedId(value, label) {
  try {
    return checkedScopeId(value, label);
  } catch {
    throw new CapabilityError("invalid_input", `Invalid ${label}`);
  }
}

export function createCapabilityStore({
  now = Date.now,
  monotonic = () => performance.now(),
  randomToken = () => randomBytes(32).toString("base64url"),
  randomId = randomUUID,
  maxExtraTabs = MAX_EXTRA_TABS,
  maxActiveGrants = MAX_ACTIVE_GRANTS,
} = {}) {
  const grants = new Map();
  const byHash = new Map();
  const listeners = new Set();

  function emit(type, grant, detail = {}) {
    const event = {
      type,
      grantId: grant.id,
      agentId: grant.agentId,
      businessId: grant.businessId,
      state: grant.state,
      ...detail,
    };
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // One failing observer must not stop the others or the policy path.
      }
    }
  }

  function view(grant) {
    return {
      id: grant.id,
      agentId: grant.agentId,
      taskId: grant.taskId,
      businessId: grant.businessId,
      clientId: grant.clientId,
      primaryTabId: grant.primaryTabId,
      tabIds: [...grant.tabIds],
      allowedOrigins: [...grant.allowedOrigins],
      privateExceptions: [...grant.privateExceptions],
      issuedAt: grant.issuedAt,
      expiresAt: grant.expiresAtWall,
      epoch: grant.epoch,
      state: grant.state,
      endedReason: grant.endedReason,
    };
  }

  function end(grant, state, reason) {
    if (grant.state !== "active") return false;
    grant.state = state;
    grant.endedReason = reason;
    grant.endedAt = now();
    grant.epoch += 1;
    emit(state === "taken-over" ? "taken-over" : state, grant, { reason });
    return true;
  }

  function isDue(grant) {
    return now() >= grant.expiresAtWall || monotonic() >= grant.expiresAtMono;
  }

  /** Lazily applies expiry so the clock is checked on every access. */
  function current(grant) {
    if (grant.state === "active" && isDue(grant))
      end(grant, "expired", "expired");
    return grant;
  }

  function normalizeOrigin(value, privateExceptions) {
    const checked = checkUrl(value, { privateExceptions });
    if (!checked.ok)
      throw new CapabilityError(
        checked.code === "invalid_input" ? "invalid_input" : "origin_denied",
        checked.reason,
      );
    return checked.origin;
  }

  function purgeEnded() {
    const ended = [...grants.values()]
      .filter((grant) => grant.state !== "active")
      .sort((a, b) => a.endedAt - b.endedAt);
    for (const grant of ended.slice(
      0,
      Math.max(0, ended.length - MAX_ENDED_GRANTS),
    )) {
      grants.delete(grant.id);
      byHash.delete(grant.tokenHash);
    }
  }

  function activeCount() {
    let count = 0;
    for (const grant of grants.values())
      if (current(grant).state === "active") count += 1;
    return count;
  }

  function issue(input) {
    if (!input || typeof input !== "object")
      throw new CapabilityError("invalid_input", "Invalid grant request");
    const agentId = checkedId(input.agentId, "agent id");
    const taskId = checkedId(input.taskId, "task id");
    const businessId = checkedId(input.businessId, "business id");
    const clientId =
      input.clientId === undefined || input.clientId === null
        ? null
        : checkedId(input.clientId, "client id");
    const primaryTabId =
      input.tabId === undefined || input.tabId === null
        ? null
        : checkedId(input.tabId, "tab id");
    let privateExceptions;
    try {
      privateExceptions = normalizePrivateExceptions(input.privateExceptions);
    } catch {
      throw new CapabilityError("invalid_input", "Invalid private exceptions");
    }
    if (
      !Array.isArray(input.allowedOrigins) ||
      input.allowedOrigins.length === 0 ||
      input.allowedOrigins.length > MAX_ALLOWED_ORIGINS
    )
      throw new CapabilityError("invalid_input", "Invalid allowed origins");
    const allowedOrigins = [
      ...new Set(
        input.allowedOrigins.map((origin) =>
          normalizeOrigin(origin, privateExceptions),
        ),
      ),
    ];
    const ttlMs = input.ttlMs ?? DEFAULT_GRANT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_GRANT_TTL_MS)
      throw new CapabilityError("invalid_input", "Invalid grant lifetime");

    // One active grant per agent: the agent's tool list must be unambiguous.
    for (const existing of grants.values()) {
      if (current(existing).state === "active" && existing.agentId === agentId)
        end(existing, "revoked", "replaced");
    }
    if (activeCount() >= maxActiveGrants)
      throw new CapabilityError("grant_limit", "Too many active grants");

    const token = randomToken();
    const issuedAt = now();
    const grant = {
      id: randomId(),
      tokenHash: sha256(token),
      agentId,
      taskId,
      businessId,
      clientId,
      primaryTabId,
      tabIds: new Set(primaryTabId ? [primaryTabId] : []),
      allowedOrigins,
      privateExceptions,
      issuedAt,
      expiresAtWall: issuedAt + ttlMs,
      expiresAtMono: monotonic() + ttlMs,
      epoch: 1,
      state: "active",
      endedReason: null,
      endedAt: null,
    };
    grants.set(grant.id, grant);
    byHash.set(grant.tokenHash, grant.id);
    purgeEnded();
    emit("issued", grant);
    return { grant: view(grant), token };
  }

  function lookup(token) {
    if (typeof token !== "string" || token.length < 16 || token.length > 128)
      return null;
    const id = byHash.get(sha256(token));
    const grant = id ? grants.get(id) : undefined;
    return grant ? current(grant) : null;
  }

  function stateFailure(grant) {
    if (grant.state === "active") return null;
    if (grant.state === "expired")
      return { ok: false, code: "grant_expired", grantId: grant.id };
    return { ok: false, code: "grant_revoked", grantId: grant.id };
  }

  function authenticate(token) {
    const grant = lookup(token);
    if (!grant) return { ok: false, code: "no_grant" };
    return stateFailure(grant) ?? { ok: true, grant: view(grant) };
  }

  /**
   * Agent side check for one operation. `tabId` must be bound to the grant,
   * `url` must be on an approved origin.
   */
  function authorize(token, { tabId, url, businessId } = {}) {
    const grant = lookup(token);
    if (!grant) return { ok: false, code: "no_grant" };
    const failed = stateFailure(grant);
    if (failed) return failed;
    if (businessId !== undefined && businessId !== grant.businessId)
      return { ok: false, code: "tab_denied" };
    if (tabId !== undefined && !grant.tabIds.has(tabId))
      return { ok: false, code: "tab_denied" };
    if (url !== undefined) {
      const origin = originOf(url);
      if (!origin) return { ok: false, code: "scheme_denied" };
      if (!grant.allowedOrigins.includes(origin))
        return { ok: false, code: "origin_approval_required", origin };
    }
    return { ok: true, grant: view(grant) };
  }

  /**
   * Snapshot of the grant epoch. A pending action keeps its fence and calls
   * `check()` at every await boundary and right before dispatching input:
   * revoke, take over, expiry and policy narrowing all fail the check.
   */
  function fence(token) {
    const grant = lookup(token);
    if (!grant) return null;
    const epoch = grant.epoch;
    const id = grant.id;
    const check = () => {
      const live = grants.get(id);
      if (!live) return { ok: false, code: "grant_revoked" };
      current(live);
      if (live.state === "expired") return { ok: false, code: "grant_expired" };
      if (live.state !== "active") return { ok: false, code: "grant_revoked" };
      if (live.epoch !== epoch) return { ok: false, code: "fenced" };
      return { ok: true };
    };
    return {
      grantId: id,
      epoch,
      check,
      assertCurrent() {
        const result = check();
        if (!result.ok)
          throw new CapabilityError(result.code, "Grant is no longer current");
      },
    };
  }

  function requireActive(grantId) {
    const grant = grants.get(grantId);
    if (!grant) throw new CapabilityError("no_grant", "Unknown grant");
    current(grant);
    if (grant.state !== "active")
      throw new CapabilityError("grant_revoked", "Grant has ended");
    return grant;
  }

  /** Person approved one more origin (widening: pending actions stay valid). */
  function approveOrigin(grantId, url, { allowPrivate = false } = {}) {
    const grant = requireActive(grantId);
    let exceptions = grant.privateExceptions;
    if (allowPrivate) {
      const parsed = (() => {
        try {
          return new URL(url);
        } catch {
          throw new CapabilityError("invalid_input", "Invalid URL");
        }
      })();
      const host = parsed.hostname.replace(/^\[|\]$/gu, "");
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      exceptions = normalizePrivateExceptions([
        ...grant.privateExceptions,
        `${host}:${port}`,
      ]);
    }
    const origin = normalizeOrigin(url, exceptions);
    if (
      !grant.allowedOrigins.includes(origin) &&
      grant.allowedOrigins.length >= MAX_ALLOWED_ORIGINS
    )
      throw new CapabilityError("invalid_input", "Too many allowed origins");
    grant.privateExceptions = exceptions;
    if (!grant.allowedOrigins.includes(origin))
      grant.allowedOrigins.push(origin);
    emit("origin-approved", grant, { origin });
    return view(grant);
  }

  /** Narrowing the grant fences every pending action. */
  function removeOrigin(grantId, origin) {
    const grant = requireActive(grantId);
    const index = grant.allowedOrigins.indexOf(origin);
    if (index === -1) return view(grant);
    if (grant.allowedOrigins.length === 1)
      throw new CapabilityError(
        "invalid_input",
        "Revoke the grant instead of removing its last origin",
      );
    grant.allowedOrigins.splice(index, 1);
    grant.epoch += 1;
    emit("origin-removed", grant, { origin });
    return view(grant);
  }

  function bindTab(grantId, tabId) {
    const grant = requireActive(grantId);
    const id = checkedId(tabId, "tab id");
    if (grant.tabIds.has(id)) return view(grant);
    if (grant.tabIds.size >= 1 + maxExtraTabs)
      throw new CapabilityError("tab_limit", "Too many tabs for this grant");
    grant.tabIds.add(id);
    if (!grant.primaryTabId) grant.primaryTabId = id;
    emit("tab-bound", grant, { tabId: id });
    return view(grant);
  }

  function unbindTab(grantId, tabId) {
    const grant = grants.get(grantId);
    if (!grant?.tabIds.delete(tabId)) return false;
    if (grant.primaryTabId === tabId) grant.primaryTabId = null;
    grant.epoch += 1;
    emit("tab-unbound", grant, { tabId });
    return true;
  }

  function revoke(grantId, reason = "revoked") {
    const grant = grants.get(grantId);
    return grant ? end(current(grant), "revoked", reason) : false;
  }

  function takeOver(grantId) {
    const grant = grants.get(grantId);
    return grant ? end(current(grant), "taken-over", "taken-over") : false;
  }

  function revokeWhere(predicate, reason) {
    let count = 0;
    for (const grant of grants.values()) {
      if (current(grant).state === "active" && predicate(grant))
        count += end(grant, "revoked", reason) ? 1 : 0;
    }
    return count;
  }

  function sweep() {
    let count = 0;
    for (const grant of grants.values()) {
      const before = grant.state;
      current(grant);
      if (before === "active" && grant.state === "expired") count += 1;
    }
    return count;
  }

  function grantsForAgent(agentId) {
    return [...grants.values()]
      .filter((grant) => current(grant).state === "active")
      .filter((grant) => grant.agentId === agentId)
      .map(view);
  }

  /** The active grant that owns a tab, or null. */
  function grantForTab(tabId) {
    for (const grant of grants.values()) {
      if (current(grant).state === "active" && grant.tabIds.has(tabId))
        return view(grant);
    }
    return null;
  }

  function getGrant(grantId) {
    const grant = grants.get(grantId);
    return grant ? view(current(grant)) : null;
  }

  function remainingMs(grantId) {
    const grant = grants.get(grantId);
    if (!grant || current(grant).state !== "active") return 0;
    return Math.max(
      0,
      Math.min(grant.expiresAtWall - now(), grant.expiresAtMono - monotonic()),
    );
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    issue,
    authenticate,
    authorize,
    fence,
    approveOrigin,
    removeOrigin,
    bindTab,
    unbindTab,
    revoke,
    takeOver,
    revokeAgent: (agentId, reason = "revoked") =>
      revokeWhere((grant) => grant.agentId === agentId, reason),
    revokeBusiness: (businessId, reason = "revoked") =>
      revokeWhere((grant) => grant.businessId === businessId, reason),
    revokeAll: (reason = "revoked") => revokeWhere(() => true, reason),
    sweep,
    grantsForAgent,
    grantForTab,
    getGrant,
    remainingMs,
    onChange,
  };
}
