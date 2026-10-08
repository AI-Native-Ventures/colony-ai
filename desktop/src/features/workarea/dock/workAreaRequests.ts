import type { WorkAreaTabKind } from "./workAreaTypes";

const REQUEST_EVENT = "colony:open-work-area-tab";
const NEW_REQUEST_EVENT = "colony:new-work-area-tab";
const CLOSE_REQUEST_EVENT = "colony:close-work-area-tab";

/**
 * Ask the mounted channel dock to open a tab. Used by controls that live
 * outside the dock (the channel's Canvas label, the toolbar's globe) and do not
 * know the channel's dock state. A kind that can be open several times focuses
 * the one the person was last on, or opens the first. Nothing happens when no
 * dock is mounted.
 */
export function requestWorkAreaTab(kind: WorkAreaTabKind) {
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: kind }));
}

export function listenForWorkAreaTabRequests(
  listener: (kind: WorkAreaTabKind) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<WorkAreaTabKind>).detail);
  window.addEventListener(REQUEST_EVENT, handler);
  return () => window.removeEventListener(REQUEST_EVENT, handler);
}

/**
 * Ask the dock for one more tab of a kind that can be open several times (a new
 * browser page). Tabs inside the dock use this so the dock stays the only place
 * that adds and removes its tabs.
 */
export function requestNewWorkAreaTab(kind: WorkAreaTabKind) {
  window.dispatchEvent(new CustomEvent(NEW_REQUEST_EVENT, { detail: kind }));
}

export function listenForNewWorkAreaTabRequests(
  listener: (kind: WorkAreaTabKind) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<WorkAreaTabKind>).detail);
  window.addEventListener(NEW_REQUEST_EVENT, handler);
  return () => window.removeEventListener(NEW_REQUEST_EVENT, handler);
}

/** Ask the dock to close one of its tabs, with the same effects as its own close button. */
export function requestCloseWorkAreaTab(tabId: string) {
  window.dispatchEvent(new CustomEvent(CLOSE_REQUEST_EVENT, { detail: tabId }));
}

export function listenForCloseWorkAreaTabRequests(
  listener: (tabId: string) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<string>).detail);
  window.addEventListener(CLOSE_REQUEST_EVENT, handler);
  return () => window.removeEventListener(CLOSE_REQUEST_EVENT, handler);
}
