export type InviteFailureKind =
  /** The code can never work: ask for a new link. */
  | "terminal"
  /** The relay wants the terms accepted first. */
  | "policy"
  /** Worth trying again as is. */
  | "retryable";

export type InviteFailure = { kind: InviteFailureKind; message: string };

const TERMINAL_MESSAGES = new Set([
  "This invite has expired. Ask your teammate to send you a new link.",
  "This invite has already been used. Ask your teammate to send you a new link.",
  "We couldn’t use this invite. It may have been cancelled, or the link may be incomplete. Ask your teammate to send you a new link.",
]);

/**
 * Whether a stored claim error is one no retry can fix. Also recognises the
 * raw codes and wording earlier builds persisted, so an old failed claim is
 * not mistaken for something worth retrying.
 */
export function isTerminalInviteMessage(message: string): boolean {
  return (
    TERMINAL_MESSAGES.has(message) ||
    /invite_(invalid|expired|exhausted)/i.test(message) ||
    /invite code has expired|reached its use limit/i.test(message)
  );
}

/** Plain Colony wording for every way joining by invite can fail. */
export function describeInviteFailure(error: unknown): InviteFailure {
  const raw = error instanceof Error ? error.message : `${error}`;
  const text = raw.toLowerCase();
  if (text.includes("invite_expired")) {
    return {
      kind: "terminal",
      message:
        "This invite has expired. Ask your teammate to send you a new link.",
    };
  }
  if (text.includes("invite_exhausted")) {
    return {
      kind: "terminal",
      message:
        "This invite has already been used. Ask your teammate to send you a new link.",
    };
  }
  if (text.includes("invite_invalid")) {
    return {
      kind: "terminal",
      message:
        "We couldn’t use this invite. It may have been cancelled, or the link may be incomplete. Ask your teammate to send you a new link.",
    };
  }
  if (text.includes("join_policy_required")) {
    return {
      kind: "policy",
      message:
        "This workspace asks you to accept its terms before you join. Review them and try again.",
    };
  }
  if (text.includes("too many") || text.includes("http 429")) {
    return {
      kind: "retryable",
      message: "Too many tries just now. Wait a minute, then try again.",
    };
  }
  return {
    kind: "retryable",
    message:
      "We couldn’t reach this workspace. Check your connection and try again.",
  };
}
