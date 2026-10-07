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

// The native layer wraps relay failures before they reach the app:
// "relay returned {status}: {message}" for an HTTP refusal (relay.rs) and
// "relay <what> query failed: {inner}" around it (relay_directory.rs), so the
// same refusal can arrive wrapped several layers deep. Every wrapper is noise
// to a person.
const RELAY_WRAPPER_PREFIX = /^relay (?:returned [^:]*|[\w -]+? failed):\s*/i;

const MEMBERSHIP_REQUIRED_SENTENCE =
  "You must be a relay member to access this relay";

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
 * The text of `error` with every native-layer wrapper removed ("relay returned
 * 403 Forbidden:", "relay owned-agent query failed:", however deeply nested).
 * Safe to apply twice; plain text passes through unchanged.
 */
export function stripRelayWrappers(error: unknown): string {
  let text = (messageOf(error) ?? "").trim();
  for (;;) {
    const next = text.replace(RELAY_WRAPPER_PREFIX, "").trim();
    if (next === text) return text;
    text = next;
  }
}

/**
 * The relay's own reason in plain words, without any wrapper, for the small
 * details line on the escape screen. Never shown as the main message. The raw
 * text belongs in the console, not on screen.
 */
export function relayMembershipDenialDetail(error: unknown): string {
  const reason = stripRelayWrappers(error);
  return reason.includes("relay_membership_required")
    ? MEMBERSHIP_REQUIRED_SENTENCE
    : reason;
}
