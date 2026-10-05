import * as React from "react";

import { parseInviteInput } from "@/shared/api/inviteHelpers";

import type { StartCommunityOnboardingInput } from "./communityOnboarding";

const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']";

/**
 * Pasting a full invite link anywhere in the app (outside a text field) offers
 * "Join <workspace>", so a person who already has a workspace need not dig
 * through the community switcher. Only complete links count: a bare code has
 * no workspace to join.
 */
export function useInvitePasteCapture(
  start: (input: StartCommunityOnboardingInput) => boolean,
  enabled: boolean,
) {
  React.useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest(EDITABLE)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const parsed = parseInviteInput(text);
      if (!parsed || !("relayWsUrl" in parsed)) return;
      // Same record a link opened from outside the app creates.
      if (
        start({
          source: "deep-link-join",
          relayUrl: parsed.relayWsUrl,
          inviteCode: parsed.code,
        })
      ) {
        event.preventDefault();
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled, start]);
}
