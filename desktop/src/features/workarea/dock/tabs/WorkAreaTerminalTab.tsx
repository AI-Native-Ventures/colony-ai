import * as React from "react";

import { setTerminalDockSlot } from "@/features/terminal/terminalDockSlot";

import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";

/**
 * The terminal tab is a slot. Terminal sessions stay owned by
 * `TerminalBootstrap`, which renders the substrate into this element while the
 * tab is on screen, so closing the dock or switching channel never ends a
 * session.
 */
export function WorkAreaTerminalTab({ active }: WorkAreaTabPanelProps) {
  const register = React.useCallback(
    (element: HTMLDivElement | null) => setTerminalDockSlot(element),
    [],
  );
  // Only the visible tab owns the slot; a hidden terminal panel must not
  // capture the substrate.
  if (!active) return null;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="work-area-terminal-slot"
      ref={register}
    />
  );
}
