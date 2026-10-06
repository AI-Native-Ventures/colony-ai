/**
 * One place that knows what a relay membership refusal looks like.
 *
 * The same refusal reaches the app in four shapes depending on the layer that
 * reports it: the HTTP bridge ("You must be a relay member"), the stable code
 * ("relay_membership_required"), and the two NIP-01 style rejections. Onboarding
 * and the open workspace both classify with this predicate so a person who was
 * removed from a community is recognised the same way wherever they land.
 */
const MEMBERSHIP_DENIED_MARKERS = [
  "You must be a relay member",
  "relay_membership_required",
  "restricted: not a relay member",
  "invalid: you are not a relay member",
] as const;

// The native layer formats HTTP failures as "relay returned {status}: {message}"
// (desktop/src-tauri/src/relay.rs). The transport prefix is noise to a person.
const RELAY_TRANSPORT_PREFIX = /^relay returned \d{3}[^:]*:\s*/i;

function messageOf(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return null;
}

/** True when `error` is the relay saying this identity is not a member. */
export function isRelayMembershipDeniedError(error: unknown): boolean {
  const message = messageOf(error);
  return (
    message !== null &&
    MEMBERSHIP_DENIED_MARKERS.some((marker) => message.includes(marker))
  );
}

/**
 * The relay's own reason without the transport prefix, for the small details
 * line on the escape screen. Never shown as the main message.
 */
export function relayMembershipDenialDetail(error: unknown): string {
  return (messageOf(error) ?? "").replace(RELAY_TRANSPORT_PREFIX, "").trim();
}
