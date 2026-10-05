import * as React from "react";

export type TerminalPanelMode = "closed" | "docked" | "maximized";

type Snapshot = {
  mode: TerminalPanelMode;
  sessionChannelIds: ReadonlySet<string>;
};

let snapshot: Snapshot = { mode: "closed", sessionChannelIds: new Set() };
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

/** Apply a panel mode directly. Only the registered host should call this. */
export function commitTerminalPanelMode(mode: TerminalPanelMode) {
  if (snapshot.mode === mode) return;
  publish({ ...snapshot, mode });
}

export function setTerminalPanelMode(mode: TerminalPanelMode) {
  if (host) {
    host.request(mode);
    return;
  }
  commitTerminalPanelMode(mode);
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
  snapshot = { mode: "closed", sessionChannelIds: new Set() };
  host = null;
}

export function getTerminalPanelSnapshotForTests() {
  return snapshot;
}
