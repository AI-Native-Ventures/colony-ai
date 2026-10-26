/**
 * The relay's own id for a business: the tenant community UUID it resolves from
 * the connection host (`communities.id`). Business records are namespaced with
 * it in their d-tags (`business:<tenant id>:prospect:<id>`) and the relay
 * refuses any other value.
 *
 * It is NOT `Community.id`, which is a random id the desktop invents when it
 * saves a community, and it is not reliably `Community.businessCommunityId`
 * either (only communities opened from the owner list carry that). The one
 * source that is right for every community - created here, joined by invite,
 * saved by an older build, reopened after a relaunch - is the relay's own
 * answer to "which communities am I in", matched by host.
 */

import {
  listMemberCommunities,
  type MyCommunitiesResponse,
} from "./selfProvisioningApi";

declare const tenantCommunityBrand: unique symbol;

/**
 * A tenant community UUID the relay confirmed for a host. The brand makes it a
 * compile error to build a business record d-tag from a local community id.
 */
export type TenantCommunityId = string & {
  readonly [tenantCommunityBrand]: true;
};

export const TENANT_COMMUNITY_UNKNOWN_MESSAGE =
  "Colony could not confirm which business this is. Check your connection and try again.";

export class TenantCommunityUnknownError extends Error {
  constructor() {
    super(TENANT_COMMUNITY_UNKNOWN_MESSAGE);
    this.name = "TenantCommunityUnknownError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The canonical (lowercase) tenant id, or null when `value` is not a UUID. */
export function parseTenantCommunityId(
  value: unknown,
): TenantCommunityId | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase() as TenantCommunityId;
}

/**
 * The host (plus any non-default port) the relay keys a community by, taken
 * from a saved relay URL. Mirrors the relay's own normalisation: lowercase,
 * default port dropped.
 */
export function relayAuthority(relayUrl: string): string | null {
  try {
    const host = new URL(relayUrl).host.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** The HTTP base of a saved relay URL (`wss://h` becomes `https://h`). */
export function relayHttpBase(relayUrl: string): string | null {
  try {
    const url = new URL(relayUrl);
    if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol === "ws:") url.protocol = "http:";
    else if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The tenant id for `relayUrl` in the relay's "communities I belong to" answer.
 * Null unless exactly one entry names that host and carries a valid UUID, so an
 * unreadable or ambiguous answer is never guessed at.
 */
export function pickTenantCommunityId(
  response: Pick<MyCommunitiesResponse, "communities"> | null | undefined,
  relayUrl: string,
): TenantCommunityId | null {
  const authority = relayAuthority(relayUrl);
  if (!authority || !Array.isArray(response?.communities)) return null;
  const matches = response.communities.filter(
    (entry) =>
      typeof entry?.normalized_host === "string" &&
      entry.normalized_host.toLowerCase() === authority,
  );
  if (matches.length !== 1) return null;
  return parseTenantCommunityId(matches[0]?.id);
}

type MemberCommunitiesLookup = (
  httpBase: string,
) => Promise<MyCommunitiesResponse>;

const resolved = new Map<string, Promise<TenantCommunityId>>();

/**
 * Asks the relay which tenant community `relayUrl` is. Answers are remembered
 * for the session (a host keeps its tenant id) and forgotten on a community
 * change; a failure is never remembered, so the next call asks again.
 * Rejects with `TenantCommunityUnknownError` for every failure: no connection,
 * no membership, no matching host, or an answer that is not a UUID.
 */
export function resolveTenantCommunityId(
  relayUrl: string,
  lookup: MemberCommunitiesLookup = listMemberCommunities,
): Promise<TenantCommunityId> {
  const authority = relayAuthority(relayUrl);
  const httpBase = relayHttpBase(relayUrl);
  if (!authority || !httpBase) {
    return Promise.reject(new TenantCommunityUnknownError());
  }
  const cached = resolved.get(authority);
  if (cached) return cached;
  const pending = (async () => {
    let answer: MyCommunitiesResponse;
    try {
      answer = await lookup(httpBase);
    } catch (error) {
      console.warn("Could not read the business id from the relay", error);
      throw new TenantCommunityUnknownError();
    }
    const id = pickTenantCommunityId(answer, relayUrl);
    if (!id) {
      console.warn("The relay did not name this business", authority);
      throw new TenantCommunityUnknownError();
    }
    return id;
  })();
  resolved.set(authority, pending);
  pending.catch(() => {
    if (resolved.get(authority) === pending) resolved.delete(authority);
  });
  return pending;
}

/** Community-scoped singleton: wired into `resetCommunityState()`. */
export function resetTenantCommunityCache(): void {
  resolved.clear();
}
