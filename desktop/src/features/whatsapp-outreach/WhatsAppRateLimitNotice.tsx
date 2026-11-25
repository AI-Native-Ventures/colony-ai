import * as React from "react";

import {
  relayHttpRetryRemainingMs,
  subscribeToRelayHttpRateLimit,
} from "@/shared/api/relayHttpRequestGate";

/** A quiet, live relay-backoff status that leaves the current screen usable. */
export function WhatsAppRateLimitNotice({
  className = "c3wa-desk-cap-note",
}: {
  className?: string;
}) {
  const [remainingMs, setRemainingMs] = React.useState(
    relayHttpRetryRemainingMs,
  );

  React.useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const next = relayHttpRetryRemainingMs();
      setRemainingMs(next);
      if (next > 0) {
        timer = window.setTimeout(update, Math.min(1_000, next));
      }
    };
    const unsubscribe = subscribeToRelayHttpRateLimit(update);
    update();
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (remainingMs <= 0) return null;
  return (
    <p
      aria-live="polite"
      className={className}
      data-testid="relay-http-rate-limit-notice"
      role="status"
    >
      Busy, trying again in {Math.max(1, Math.ceil(remainingMs / 1_000))} s
    </p>
  );
}
