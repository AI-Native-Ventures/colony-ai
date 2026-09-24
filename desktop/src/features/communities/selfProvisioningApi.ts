import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";

import type { RawCommunityProvisioningConfig } from "./selfProvisioning";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

export type CommunityAvailability = {
  name: string;
  normalized_host?: string;
  available: boolean;
  reason?: string;
};

export type SelfServeCommunity = {
  id: string;
  name: string;
  slug: string;
  normalized_host: string;
  owner_pubkey: string;
};

export type SelfServeCreateResponse = {
  community: SelfServeCommunity;
};

export type MyCommunitiesResponse = {
  owner_pubkey: string;
  communities: SelfServeCommunity[];
};

export class CommunityProvisioningRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "CommunityProvisioningRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function getSelfProvisioningHttpBase(): Promise<string> {
  return (await getRelayHttpUrl()).replace(/\/+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function nip98Header(
  url: string,
  method: "GET" | "POST",
  body?: string,
): Promise<string> {
  const tags = [
    ["u", url],
    ["method", method],
    ["nonce", crypto.randomUUID()],
  ];
  if (body !== undefined) tags.push(["payload", await sha256Hex(body)]);
  const event = await signRelayEvent({ kind: NIP98_KIND, content: "", tags });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

async function requestJson<T>(
  httpBase: string,
  path: string,
  method: "GET" | "POST",
  body?: string,
  signed = false,
): Promise<T> {
  const url = `${httpBase.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (signed) headers.Authorization = await nip98Header(url, method, body);

  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const code =
      typeof payload.error === "string"
        ? payload.error
        : `http_${response.status}`;
    throw new CommunityProvisioningRequestError(response.status, code);
  }
  return payload as T;
}

export function fetchCommunityProvisioningConfig(
  httpBase: string,
): Promise<RawCommunityProvisioningConfig> {
  return requestJson(httpBase, "/api/communities/config", "GET");
}

export function checkCommunityAvailability(
  httpBase: string,
  slug: string,
): Promise<CommunityAvailability> {
  return requestJson(
    httpBase,
    `/api/communities/availability?name=${encodeURIComponent(slug)}`,
    "GET",
  );
}

export function createSelfServeCommunity(
  httpBase: string,
  slug: string,
): Promise<SelfServeCreateResponse> {
  return requestJson(
    httpBase,
    "/api/communities",
    "POST",
    JSON.stringify({ name: slug }),
    true,
  );
}

export function listMyCommunities(
  httpBase: string,
): Promise<MyCommunitiesResponse> {
  return requestJson(httpBase, "/api/communities/mine", "GET", undefined, true);
}
