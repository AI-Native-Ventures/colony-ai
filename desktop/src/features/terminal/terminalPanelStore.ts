import * as React from "react";

export type TerminalPanelMode = "closed" | "docked" | "maximized";

type Snapshot = {
  mode: TerminalPanelMode;
  sessionChannelIds: ReadonlySet<string>;
  /** Channel whose dock is showing the terminal; null outside a host. */
  hostChannelId: string | null;
};

let snapshot: Snapshot = {
  mode: "closed",
  sessionChannelIds: new Set(),
  hostChannelId: null,
};
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * A host owns the panel's visibility when the terminal lives inside another
 * surface (the channel work area dock). Requests from every caller (buttons,
 * the Cmd+J chord, the substrate's own Hide) are routed to it, and it applies
 * the result with `commitTerminalPanelMode`, so there is a single source of
 * truth. Without a host the panel behaves as the legacy bottom dock.
 */
export type TerminalPanelHost = {
  request: (mode: TerminalPanelMode) => void;
};

let host: TerminalPanelHost | null = null;

/** Register the owning host. Returns the matching unregister function. */
export function registerTerminalPanelHost(next: TerminalPanelHost) {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/**
 * Apply a panel mode directly. Only the registered host should call this, and
 * it says which channel the terminal is being shown for.
 */
export function commitTerminalPanelMode(
  mode: TerminalPanelMode,
  hostChannelId: string | null = null,
) {
  if (snapshot.mode === mode && snapshot.hostChannelId === hostChannelId)
    return;
  publish({ ...snapshot, mode, hostChannelId });
}

export function isTerminalPanelHosted(): boolean {
  return host !== null;
}

export function setTerminalPanelMode(mode: TerminalPanelMode) {
  if (host) {
    host.request(mode);
    return;
  }
  commitTerminalPanelMode(mode);
}

/**
 * The snapshot right now, read at call time. Effects use this instead of the
 * render-time snapshot when a host may have changed it earlier in the same
 * commit (a channel switch that hides the dock's terminal tab).
 */
export function getTerminalPanelSnapshot(): Snapshot {
  return snapshot;
}

export function toggleTerminalPanel() {
  setTerminalPanelMode(snapshot.mode === "closed" ? "docked" : "closed");
}

export function setTerminalSessionChannels(channelIds: Iterable<string>) {
  const next = new Set(channelIds);
  if (
    next.size === snapshot.sessionChannelIds.size &&
    [...next].every((id) => snapshot.sessionChannelIds.has(id))
  )
    return;
  publish({ ...snapshot, sessionChannelIds: next });
}

export function useTerminalPanel() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export function resetTerminalPanelForTests() {
  snapshot = {
    mode: "closed",
    sessionChannelIds: new Set(),
    hostChannelId: null,
  };
  host = null;
}

export function getTerminalPanelSnapshotForTests() {
  return snapshot;
}
