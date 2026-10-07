import * as React from "react";

import { browserHost } from "@/shared/api/browserHost";

import { bindNativeView } from "./browserNativeView";

type BrowserNativeSlotProps = {
  /** The live host tab to show, or null when the slot shows nothing. */
  hostId: string | null;
  /** False while the dock tab is not the one on screen. */
  visible: boolean;
  /** Moves keyboard focus into the page (the keyboard route into the view). */
  onEnterPage: () => void;
  /** Called if the host keeps refusing to show the page. */
  onFailure: (message: string) => void;
  hintId: string;
};

/**
 * The box the page view fills. The page itself is an Electron view drawn above
 * the window, so this element only reserves the space and keeps the view
 * attached to it (`bindNativeView`). It is a button so a keyboard user has a
 * way into the page: Enter or Space hands keyboard focus to the view, and
 * Control or Command plus L (relayed by the host) brings it back. A pointer
 * click lands on the page view itself, which sits above this button.
 */
export function BrowserNativeSlot({
  hostId,
  visible,
  onEnterPage,
  onFailure,
  hintId,
}: BrowserNativeSlotProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const failureRef = React.useRef(onFailure);
  failureRef.current = onFailure;

  React.useEffect(() => {
    const element = ref.current;
    if (!hostId || !element) return;
    return bindNativeView(hostId, {
      host: browserHost,
      element,
      visible,
      onFailure: (message) => failureRef.current(message),
    });
  }, [hostId, visible]);

  return (
    <button
      aria-describedby={hintId}
      aria-label="Move the keyboard into the page"
      className="colony-browser-slot"
      data-testid="browser-page-slot"
      onClick={onEnterPage}
      type="button"
    >
      <span className="colony-browser-slot-fill" ref={ref} />
    </button>
  );
}
