/**
 * Application menu for the Electron shell.
 *
 * Mirrors the Tauri app's menu (`src-tauri/src/app_menu.rs`), which the hidden
 * host no longer installs. The Edit submenu is load-bearing on macOS: without
 * its roles, Cmd+C/V/X/A/Z do nothing in the renderer. There is deliberately no
 * Close Window item, so Cmd+W reaches the app's own shortcut handler.
 */
export function appMenuTemplate({ name, platform }) {
  const template = [];
  if (platform === "darwin") {
    template.push({
      label: name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  template.push(
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "View", submenu: [{ role: "togglefullscreen" }] },
    {
      label: "Window",
      role: "windowMenu",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
    { label: "Help", role: "help", submenu: [] },
  );
  return template;
}

/** Install the menu. Windows and Linux keep the menu bar hidden like Tauri. */
export function installAppMenu({ Menu, app, platform = process.platform }) {
  const menu = Menu.buildFromTemplate(
    appMenuTemplate({ name: app.getName(), platform }),
  );
  Menu.setApplicationMenu(platform === "darwin" ? menu : null);
  return menu;
}
