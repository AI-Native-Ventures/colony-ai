// Minimal placeholder; the shell-plugins lane replaces this module with full
// Tauri window/app/webview coverage.
export function createShellPlugins({ app, getWindow }) {
  const window = () => getWindow();
  const table = {
    "plugin:window|show": () => window().show(),
    "plugin:window|hide": () => window().hide(),
    "plugin:window|set_focus": () => window().focus(),
    "plugin:window|is_fullscreen": () => window().isFullScreen(),
    "plugin:window|is_focused": () => window().isFocused(),
    "plugin:window|is_visible": () => window().isVisible(),
    "plugin:window|scale_factor": () => 2,
    "plugin:window|start_dragging": () => null,
    "plugin:window|set_title": (args) =>
      window().setTitle(String(args.value ?? "")),
    "plugin:app|version": () => app.getVersion(),
    "plugin:app|name": () => app.getName(),
  };
  return {
    handles: (command) =>
      typeof command === "string" &&
      /^plugin:(window|webview|app)\|/.test(command),
    invoke: async (command, args) => {
      const handler = table[command];
      if (!handler) {
        console.warn(`colony-shell: unhandled ${command}`);
        return null;
      }
      return (await handler(args)) ?? null;
    },
    attachWindowEvents: () => () => {},
  };
}
