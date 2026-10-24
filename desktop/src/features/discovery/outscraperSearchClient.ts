import { relayHttpFromWs } from "@/shared/api/inviteHelpers";
import { signRelayEvent } from "@/shared/api/tauri";

import {
  DiscoverySearchError,
  NETWORK_ERROR_MESSAGE,
  parseSearchResponse,
  searchErrorFromHttp,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";

declare global {
  interface Window {
    /**
     * Test builds only: answers a prospect search page without the relay.
     * Throw an Error (optionally with a string `code`) to simulate a failure.
     */
    __BUZZ_E2E_DISCOVERY_SEARCH__?: (
      request: DiscoverySearchRequest,
      signal?: AbortSignal,
    ) => Promise<unknown>;
  }
}

const SEARCH_PATH = "/discovery/search";
const NIP98_KIND = 27235;
/** The server may wait on the provider for about a minute per page. */
const REQUEST_TIMEOUT_MS = 120_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function nip98PostHeader(url: string, body: string): Promise<string> {
  const authEvent = await signRelayEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", await sha256Hex(body)],
      ["nonce", crypto.randomUUID()],
    ],
  });
  return `Nostr ${btoa(JSON.stringify(authEvent))}`;
}

function abortError(): DOMException {
  return new DOMException("The search was stopped.", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorFromHook(error: unknown): Error {
  if (isAbort(error)) return error as DOMException;
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : NETWORK_ERROR_MESSAGE;
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? ((error as { code: string }).code ?? null)
      : null;
  return new DiscoverySearchError(message, { code });
}

/**
 * Runs one page of the prospect search through the community's relay. The
 * provider key stays on the server; the app only signs a NIP-98 header. Errors
 * are `DiscoverySearchError`s carrying plain words, except an `AbortError`
 * when `signal` fires.
 */
export async function searchPlaces(input: {
  relayUrl: string;
  request: DiscoverySearchRequest;
  signal?: AbortSignal;
}): Promise<DiscoverySearchResponse> {
  const { relayUrl, request, signal } = input;
  if (signal?.aborted) throw abortError();

  const hook =
    typeof window === "undefined"
      ? undefined
      : window.__BUZZ_E2E_DISCOVERY_SEARCH__;
  if (hook) {
    let raw: unknown;
    try {
      raw = await hook(request, signal);
    } catch (error) {
      throw errorFromHook(error);
    }
    return parseSearchResponse(raw);
  }

  let url: string;
  try {
    url = `${relayHttpFromWs(relayUrl).replace(/\/+$/, "")}${SEARCH_PATH}`;
  } catch {
    throw new DiscoverySearchError(NETWORK_ERROR_MESSAGE, {
      code: "network",
    });
  }
  const body = JSON.stringify(request);

  // One controller carries both the caller's stop and the request timeout.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        body,
        headers: {
          Authorization: await nip98PostHeader(url, body),
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (isAbort(error)) {
        throw new DiscoverySearchError(
          "The prospect search took too long. Try again.",
          { code: "network" },
        );
      }
      throw new DiscoverySearchError(NETWORK_ERROR_MESSAGE, {
        code: "network",
      });
    }
    if (!response.ok) {
      const json: unknown = await response.json().catch(() => null);
      throw searchErrorFromHttp(response.status, json);
    }
    const json: unknown = await response.json().catch(() => null);
    return parseSearchResponse(json);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
