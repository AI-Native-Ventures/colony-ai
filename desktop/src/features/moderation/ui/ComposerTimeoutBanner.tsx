import { TimeoutGlyph } from "@/features/messages/ui/ComposerIcons";
import { formatTimeoutRemaining } from "@/features/moderation/lib/timeout";

/**
 * The amber header at the top of the composer card while the member is timed
 * out by community moderators. Shows a live countdown when the expiry is
 * known; otherwise states the block without a timer (the relay gave no
 * timestamp).
 *
 * Purely presentational: the timeout state and its per-second tick are owned
 * by {@link useTimeoutState}; this only formats what it is handed.
 */
export function ComposerTimeoutBanner({
  expiresAtMs,
}: {
  /** Timeout expiry in epoch ms, or null when the relay gave no timestamp. */
  expiresAtMs: number | null;
}) {
  const remaining = formatTimeoutRemaining(expiresAtMs);

  return (
    <div
      className="c3c-banner"
      data-kind="timeout"
      data-testid="composer-timeout-banner"
      role="status"
    >
      <TimeoutGlyph className="c3c-banner-icon" />
      <span className="c3c-banner-text">
        {remaining
          ? `You're timed out by community moderators - ${remaining} left.`
          : "You're timed out by community moderators."}
      </span>
    </div>
  );
}
