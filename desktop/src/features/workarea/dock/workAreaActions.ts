import {
  closeWorkArea,
  closeWorkAreaTab,
  getWorkAreaState,
  openWorkArea,
  toggleWorkArea,
} from "./workAreaStore";
import type { WorkAreaTabKind } from "./workAreaTypes";

/**
 * Focus bookkeeping for the dock. Whatever opened it (the Work area button,
 * the shortcut, a file link in a message) is remembered, and closing the dock
 * hands focus back there so keyboard users never land on <body>.
 */
export const WORK_AREA_TRIGGER_TESTID = "channel-work-area-trigger";

let trigger: HTMLElement | null = null;

function rememberTrigger(source: Element | null | undefined) {
  if (source instanceof HTMLElement && source !== document.body) {
    trigger = source;
  }
}

function restoreTriggerFocus() {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    // Only act when focus was lost with the dock; never steal it from a
    // field the user is typing in.
    if (active && active !== document.body) return;
    const fallback = document.querySelector<HTMLElement>(
      `[data-testid="${WORK_AREA_TRIGGER_TESTID}"]`,
    );
    const target = trigger?.isConnected ? trigger : fallback;
    target?.focus({ preventScroll: true });
  });
}

/** After an explicit open, put focus on the selected tab (or the first choice). */
function focusDockSoon() {
  window.requestAnimationFrame(() => {
    const panel = document.querySelector<HTMLElement>(
      '[data-testid="work-area-panel"]',
    );
    const target =
      panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      panel?.querySelector<HTMLElement>(".colony-work-area-choice");
    target?.focus({ preventScroll: true });
  });
}

/**
 * Open the dock (optionally on a tab) on behalf of `source`, the control that
 * asked for it. Focus moves into the dock and returns to `source` on close.
 */
export function openWorkAreaFrom(
  channelId: string,
  kind: WorkAreaTabKind | undefined,
  source: Element | null | undefined,
) {
  rememberTrigger(source);
  openWorkArea(channelId, kind);
  focusDockSoon();
}

export function closeWorkAreaRestoringFocus(channelId: string) {
  closeWorkArea(channelId);
  restoreTriggerFocus();
}

/** Closing the last tab closes the dock, so focus has to go somewhere. */
export function closeWorkAreaTabRestoringFocus(
  channelId: string,
  tabId: string,
) {
  closeWorkAreaTab(channelId, tabId);
  if (!getWorkAreaState(channelId).open) restoreTriggerFocus();
}

export function toggleWorkAreaFrom(
  channelId: string,
  source: Element | null | undefined,
) {
  if (getWorkAreaState(channelId).open) {
    closeWorkAreaRestoringFocus(channelId);
    return;
  }
  rememberTrigger(source);
  toggleWorkArea(channelId);
  focusDockSoon();
}
