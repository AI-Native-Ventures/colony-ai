import type * as React from "react";

import { isRelayHttpRateLimitError } from "@/shared/api/relayHttpRequestGate";
import { WhatsAppRateLimitNotice } from "./WhatsAppRateLimitNotice";

/** Returns the outreach error state without replacing a rate-limited view with red copy. */
export function getWhatsAppOutreachLoadFailure({
  errors,
  hasStatus,
}: Readonly<{
  errors: readonly unknown[];
  hasStatus: boolean;
}>): React.ReactElement | null {
  const loadError = errors.find(
    (error) => error && !isRelayHttpRateLimitError(error),
  );
  if (loadError) {
    return (
      <main className="c3wa-root c3wa-outreach-error" role="alert">
        {loadError instanceof Error
          ? loadError.message
          : "WhatsApp conversations could not be loaded."}
      </main>
    );
  }
  if (!hasStatus && errors.some(isRelayHttpRateLimitError)) {
    return (
      <main className="c3wa-root c3wa-outreach-empty">
        <WhatsAppRateLimitNotice />
        <p>Recent WhatsApp conversations will reload shortly.</p>
      </main>
    );
  }
  return null;
}
