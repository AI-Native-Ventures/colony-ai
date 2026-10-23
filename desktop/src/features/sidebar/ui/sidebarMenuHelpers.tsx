import type * as React from "react";

/**
 * Run a menu action on the next tick. Radix closes the menu on select and
 * restores focus; deferring the action avoids opening a modal dialog while
 * the menu is still tearing down (which can leave `pointer-events: none`
 * stuck on <body> and freeze the app).
 */
export function deferMenuAction(action: () => void) {
  globalThis.setTimeout(action, 0);
}

/**
 * Context-menu rows in Colony 3.0 are text only (`SidebarMenus.dc.html`), so
 * the leading icon slot that used to keep labels aligned now renders nothing.
 * Call sites keep passing their icon so a row can regain one without a new
 * component.
 */
export function ContextMenuIconSlot(_props: { children?: React.ReactNode }) {
  return null;
}
