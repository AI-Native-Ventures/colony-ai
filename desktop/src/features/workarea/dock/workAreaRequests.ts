import type { WorkAreaTabKind } from "./workAreaTypes";

const REQUEST_EVENT = "colony:open-work-area-tab";

/**
 * Ask the mounted channel dock to open a tab. Used by controls that live
 * outside the dock (the channel's Canvas label) and do not know the channel's
 * dock state. Nothing happens when no dock is mounted.
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
