import { TimeoutGlyph } from "@/features/messages/ui/ComposerIcons";

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "52 minutes", "1 hour 5 minutes", "30 seconds"; null once it has expired. */
function describeRemaining(expiresAtMs: number | null): string | null {
  if (expiresAtMs === null) return null;
  const seconds = Math.ceil((expiresAtMs - Date.now()) / 1000);
  if (seconds <= 0) return null;
  if (seconds < 60) return plural(seconds, "second");
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) return plural(totalMinutes, "minute");
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hoursText = plural(hours, "hour");
  return minutes === 0
    ? hoursText
    : `${hoursText} ${plural(minutes, "minute")}`;
}

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
  const remaining = describeRemaining(expiresAtMs);

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
