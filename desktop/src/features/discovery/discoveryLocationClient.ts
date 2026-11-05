import { relayHttpFromWs } from "@/shared/api/inviteHelpers";
import { signRelayEvent } from "@/shared/api/tauri";

import {
  parseDiscoveryLocationSuggestions,
  type DiscoveryLocation,
} from "./discoveryLocation";
import {
  DiscoverySearchError,
  NETWORK_ERROR_MESSAGE,
  searchErrorFromHttp,
} from "./discoverySearch";

export type DiscoveryLocationRequest = { query: string };

declare global {
  interface Window {
    /** Test-only relay replacement for the location combobox. */
    __BUZZ_E2E_DISCOVERY_LOCATIONS__?: (
      request: DiscoveryLocationRequest,
      signal?: AbortSignal,
    ) => Promise<unknown>;
  }
}

const LOCATION_PATH = "/discovery/locations";
const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

function abortError(): DOMException {
  return new DOMException("The location search was stopped.", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

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

function hookError(error: unknown): Error {
  if (isAbort(error)) return error as DOMException;
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : NETWORK_ERROR_MESSAGE;
  return new DiscoverySearchError(message, {
    code:
      typeof (error as { code?: unknown } | null)?.code === "string"
        ? (error as { code: string }).code
        : null,
  });
}

/**
 * Searches the relay-owned geocoder. The desktop only sends its selected text
 * to the authenticated relay and never sends a location lookup to a third
 * party directly, so the public provider never receives a person's IP.
 */
export async function searchDiscoveryLocations(input: {
  relayUrl: string;
  request: DiscoveryLocationRequest;
  signal?: AbortSignal;
}): Promise<DiscoveryLocation[]> {
  const { relayUrl, request, signal } = input;
  if (signal?.aborted) throw abortError();
  const query = request.query.trim();
  if (query.length < 2) return [];

  const hook =
    typeof window === "undefined"
      ? undefined
      : window.__BUZZ_E2E_DISCOVERY_LOCATIONS__;
  if (hook) {
    try {
      return parseDiscoveryLocationSuggestions(await hook({ query }, signal));
    } catch (error) {
      throw hookError(error);
    }
  }

  let url: string;
  try {
    url = `${relayHttpFromWs(relayUrl).replace(/\/+$/, "")}${LOCATION_PATH}`;
  } catch {
    throw new DiscoverySearchError(NETWORK_ERROR_MESSAGE, { code: "network" });
  }
  const body = JSON.stringify({ query });
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
          "The location search took too long. Try again.",
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
    return parseDiscoveryLocationSuggestions(json);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
