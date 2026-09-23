// Pure window rules shared by main and app-window; no Electron imports so
// they can be tested directly.

/** Title-bar double-click actions routed from the native host. */
export function applyWindowAction(window, action, screen) {
  if (action === "minimize") window.minimize();
  else if (action === "toggle-maximize") {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  } else if (action === "fill-work-area")
    window.setBounds(screen.getDisplayMatching(window.getBounds()).workArea);
}

/** Window labels follow Tauri's: `main`, or `huddle-<channel uuid>`. */
export function validWindowLabel(label) {
  return (
    label === "main" ||
    /^huddle-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      label,
    )
  );
}
