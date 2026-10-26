/**
 * The one name people see for the app: the macOS app menu and About panel,
 * window titles, the Dock and the Windows taskbar.
 *
 * It is display-only. Where data lives (the Electron userData folder, the
 * bundle ID and the native profile hash, the keychain service, the deep-link
 * schemes) is derived from fixed identifiers, never from this name, so the
 * name can change without moving anyone's data. `branding.test.mjs` pins both
 * halves.
 */
export const APP_NAME = "Colony";

/**
 * Windows groups taskbar buttons and attributes toasts by this ID. The
 * installer shortcut carries the same ID (the electron-builder `appId`), so
 * without it a running Colony is shown as "electron.app.Colony".
 */
export const WINDOWS_APP_USER_MODEL_ID = "xyz.block.buzz.app.electron";

/** Name the app everywhere the OS asks Electron for it. Call before ready. */
export function applyAppBranding(app, { platform = process.platform } = {}) {
  app.setName(APP_NAME);
  app.setAboutPanelOptions?.({ applicationName: APP_NAME });
  if (platform === "win32") app.setAppUserModelId?.(WINDOWS_APP_USER_MODEL_ID);
}

/**
 * The renderer document has no title, which would blank the native title the
 * window was created with (and the macOS Window menu entry). Keep it.
 */
export function keepWindowTitle(window) {
  window.on("page-title-updated", (event) => event.preventDefault());
}
