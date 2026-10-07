import type { BrowserShortcutAction } from "@/shared/api/browserHost";

/**
 * The browser tab's keyboard shortcuts for the app's own controls (address
 * bar, tab strip, toolbar). While a page has focus the Electron host maps the
 * same keys itself (`browserShortcutAction` in `electron/browser-host-policy.mjs`)
 * and relays them here as `shortcut` events, so the two paths must agree; a
 * node test runs both over the same key grid.
 *
 * `mac` follows the platform: Command on macOS, Control elsewhere. Option+Arrow
 * is word movement in a macOS text field, so Alt history keys are for Windows
 * and Linux only.
 */
export type ShortcutKeyInput = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
};

export function browserShortcutFromKey(
  input: ShortcutKeyInput,
  mac: boolean,
): BrowserShortcutAction | null {
  if (input.repeat || input.isComposing) return null;
  const primary = mac ? input.metaKey : input.ctrlKey;
  const other = mac ? input.ctrlKey : input.metaKey;
  if (other) return null;
  const key = input.key.toLowerCase();
  if (primary && !input.altKey) {
    if (input.shiftKey) return null;
    switch (key) {
      case "l":
        return "focus-address";
      case "t":
        return "new-tab";
      case "w":
        return "close-tab";
      case "r":
        return "reload";
      case "[":
        return "back";
      case "]":
        return "forward";
      case "\\":
        return "toggle-dock";
      default:
        return null;
    }
  }
  if (!mac && !primary && input.altKey && !input.shiftKey) {
    if (key === "arrowleft") return "back";
    if (key === "arrowright") return "forward";
  }
  if (!primary && !input.altKey && !input.shiftKey && key === "f5")
    return "reload";
  return null;
}
