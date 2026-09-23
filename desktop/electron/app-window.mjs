import path from "node:path";
import { BrowserWindow, app, nativeTheme, shell } from "electron";
import { RendererHost } from "./renderer-host.mjs";
import { createShellPlugins } from "./shell-plugins.mjs";
import { validWindowLabel } from "./window-rules.mjs";

export { applyWindowAction, validWindowLabel } from "./window-rules.mjs";

const DRAG_REGION_CSS =
  "[data-tauri-drag-region]{-webkit-app-region:drag} [data-tauri-drag-region] button,[data-tauri-drag-region] input,[data-tauri-drag-region] a{-webkit-app-region:no-drag}";

/**
 * One app window: its own renderer generation fence and shell plugins over the
 * shared native host. The renderer learns its label from the preload so the
 * Tauri window API (`getCurrentWindow().label`) keeps working per window.
 */
export function createAppWindow({
  label,
  host,
  desktop,
  trusted,
  onUntrustedOpen,
  browserOptions = {},
}) {
  if (!validWindowLabel(label)) throw new Error("Invalid window label");
  const main = label === "main";
  const window = new BrowserWindow({
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17151b" : "#ffffff",
    ...browserOptions,
    webPreferences: {
      preload: path.join(desktop, "electron", "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--colony-window-label=${label}`],
    },
  });
  const rendererHost = new RendererHost(
    host,
    main ? undefined : { resetCommands: [] },
  );
  const send = (message) => {
    if (!window.isDestroyed()) window.webContents.send("colony:event", message);
  };
  const shellPlugins = createShellPlugins({
    app,
    shell,
    nativeTheme,
    getWindow: () => window,
    emit: (event, payload) => send({ type: "shell-event", event, payload }),
  });
  const disposeWindowEvents = shellPlugins.attachWindowEvents(window);
  rendererHost.on("event", send);
  rendererHost.on("channel", send);

  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    onUntrustedOpen(url);
    return { action: "deny" };
  });
  let initialNavigation = true;
  window.webContents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (initialNavigation) {
      initialNavigation = false;
      return;
    }
    // A reload retires the previous renderer's subscriptions and channels
    // before the new one may issue commands.
    void rendererHost.reset().catch(() => {
      send({
        type: "shell",
        name: "disconnected",
        payload: "Native renderer cleanup failed; restart the app",
      });
    });
  });

  /** Handle one renderer request that already passed the sender check. */
  async function dispatch(type, payload) {
    if (type === "invoke" && shellPlugins.handles(payload.command))
      return shellPlugins.invoke(payload.command, payload.args ?? {});
    if (["invoke", "listen", "unlisten", "emit"].includes(type))
      return rendererHost.request(type, payload);
    throw new Error("Unsupported desktop request");
  }

  async function load(url) {
    await window.loadURL(url);
    await window.webContents.insertCSS(DRAG_REGION_CSS);
  }

  /** Retire this window's native subscriptions; the host keeps running. */
  async function dispose() {
    disposeWindowEvents();
    if (!main) await rendererHost.reset().catch(() => {});
  }

  return { label, window, send, dispatch, load, dispose, rendererHost };
}
