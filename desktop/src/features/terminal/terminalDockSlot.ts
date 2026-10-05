import * as React from "react";

/**
 * The element inside the work area dock that hosts the terminal tab's
 * substrate. The terminal's sessions stay owned by `TerminalBootstrap`
 * (AppShell level), which portals the substrate into this slot while one is
 * registered. Registering and clearing the slot never touches sessions.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setTerminalDockSlot(next: HTMLElement | null) {
  if (slot === next) return;
  slot = next;
  for (const listener of listeners) listener();
}

export function useTerminalDockSlot(): HTMLElement | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null,
  );
}
