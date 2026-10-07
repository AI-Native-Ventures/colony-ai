import { stripRelayWrappers } from "./relayMembershipDenied";

/**
 * Utilities for classifying relay connectivity errors.
 *
 * The Rust backend (`desktop/src-tauri/src/relay.rs`) prefixes every
 * "relay unreachable" error message with this literal string so that the
 * frontend can distinguish a transient connectivity failure (e.g. corporate VPN
 * needs reauth, Cloudflare Access 403) from an application-level error.
 *
 * Contract: the Rust layer MUST emit errors starting with exactly this prefix
 * for any condition where the relay host is unreachable at the network or
 * auth layer. Do not change this string without updating relay.rs in lockstep.
 */
const RELAY_UNREACHABLE_PREFIX = "relay unreachable:";

export const RELAY_UNREACHABLE_SHORT = "Can't reach the relay.";
export const RELAY_UNREACHABLE_MESSAGE =
  "Can't reach the relay — check your VPN or network connection.";

/**
 * Returns true when `error` carries the stable Rust-layer prefix indicating
 * the relay is unreachable (network failure, VPN reauth needed, etc.).
 *
 * Accepts both `Error` instances and raw strings so callers can pass whatever
 * the Tauri IPC or WebSocket layer hands them without pre-normalizing.
 */
export function isRelayUnreachableError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.startsWith(RELAY_UNREACHABLE_PREFIX);
  }
  if (typeof error === "string") {
    return error.startsWith(RELAY_UNREACHABLE_PREFIX);
  }
  return false;
}

export const RELAY_GENERIC_ERROR_MESSAGE =
  "Colony could not reach this community. Try again.";

/**
 * True when `error` is native-layer relay text a person should never read:
 * a wrapper ("relay returned 500 ...", "relay owned-agent query failed: ..."),
 * or the unreachable prefix, however deeply nested.
 */
export function isTechnicalRelayError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const inner = stripRelayWrappers(text);
  return (
    inner !== text.trim() ||
    isRelayUnreachableError(inner) ||
    /^relay returned\b/i.test(inner)
  );
}

/**
 * The sentence a person sees for any relay failure. Raw relay text ("relay
 * returned 403 Forbidden: ...") is technical and stays in the console, never
 * on screen.
 */
export function plainRelayErrorMessage(error: unknown): string {
  return isRelayUnreachableError(stripRelayWrappers(error))
    ? RELAY_UNREACHABLE_SHORT
    : RELAY_GENERIC_ERROR_MESSAGE;
}
