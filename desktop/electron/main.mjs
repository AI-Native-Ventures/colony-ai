import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  shell,
} from "electron";
import { NativeHost } from "./native-host.mjs";
import { RendererHost } from "./renderer-host.mjs";
import { createShellPlugins } from "./shell-plugins.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const smoke = process.env.COLONY_ELECTRON_SMOKE === "1";
const devUrl = app.isPackaged
  ? null
  : process.env.COLONY_ELECTRON_DEV_URL || null;
const SHOW_WINDOW_EVENT = "electron-shell:show-window";

function nativeHostPath() {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (process.env.COLONY_NATIVE_HOST) return process.env.COLONY_NATIVE_HOST;
  if (app.isPackaged)
    return path.join(process.resourcesPath, `colony-native-host${exe}`);
  return path.join(
    desktop,
    "src-tauri",
    "target",
    "debug",
    `colony-native-host${exe}`,
  );
}

app.setPath(
  "userData",
  process.env.COLONY_ELECTRON_USER_DATA ||
    path.join(
      app.getPath("appData"),
      app.isPackaged ? "Colony Electron" : "Colony Electron Dev",
    ),
);
const primaryInstance = smoke || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "colony",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let host = null;
let quitting = false;
let mainWindow = null;
let quitApp = async () => app.quit();

app.on("second-instance", () => revealWindow());

function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Content-Security-Policy from the Tauri config, adapted to the colony scheme. */
async function contentSecurityPolicy(html) {
  const config = JSON.parse(
    await readFile(path.join(desktop, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  // Inline scripts in our own entry document are authorized by content hash.
  const hashes = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((match) => !/\bsrc=/.test(match[1]) && match[2].trim())
    .map(
      (match) =>
        ` 'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`,
    )
    .join("");
  let csp = config.app.security.csp.replace(
    "script-src 'self'",
    `script-src 'self'${hashes}`,
  );
  if (devUrl) {
    // Vite serves modules and HMR over the dev origin.
    const origin = new URL(devUrl).origin;
    const ws = origin.replace(/^http/, "ws");
    csp = csp
      .replace("script-src 'self'", `script-src 'self' ${origin}`)
      .replace("connect-src 'self'", `connect-src 'self' ${origin} ${ws}`);
  }
  return csp;
}

function serveRenderer(csp) {
  const root = path.join(desktop, "dist");
  protocol.handle("colony", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app")
      return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(
      root,
      !relative || !path.extname(relative) ? "index.html" : relative,
    );
    if (!file.startsWith(root + path.sep))
      return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    return new Response(response.body, { status: response.status, headers });
  });
}

async function boot() {
  await app.whenReady();
  const html = devUrl
    ? await (await fetch(devUrl)).text()
    : await readFile(path.join(desktop, "dist", "index.html"), "utf8");
  const csp = await contentSecurityPolicy(html);
  serveRenderer(csp);

  const profileId = createHash("sha256")
    .update(app.getPath("userData"))
    .digest("hex")
    .slice(0, 16);
  host = new NativeHost(nativeHostPath(), {
    env: {
      ...process.env,
      COLONY_ELECTRON_PACKAGED: app.isPackaged ? "1" : "0",
      COLONY_ELECTRON_PROFILE_ID: profileId,
    },
    timeout: 120_000,
  });
  const rendererHost = new RendererHost(host);

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: "Buzz",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17151b" : "#ffffff",
    webPreferences: {
      preload: path.join(desktop, "electron", "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;

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
  host.on("disconnected", (message) => {
    if (quitting) return;
    // A clean host exit is a native quit request (tray or app menu Quit).
    if (host.child.exitCode === 0) {
      void quitApp();
      return;
    }
    console.error(`Colony native host stopped: ${message}`);
    send({ type: "shell", name: "disconnected", payload: message });
  });

  const origin = devUrl ? new URL(devUrl).origin : "colony://app";
  const trusted = (url) => {
    try {
      return devUrl
        ? new URL(url).origin === origin
        : url.startsWith("colony://app/");
    } catch {
      return false;
    }
  };
  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in the system browser, never inside the app.
    try {
      const parsed = new URL(url);
      if (["https:", "http:", "mailto:"].includes(parsed.protocol))
        void shell.openExternal(parsed.href);
    } catch {
      // Ignore malformed targets.
    }
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

  const dispatch = async (event, type, payload = {}) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error("Untrusted desktop caller");
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Invalid request");
    if (type === "invoke" && shellPlugins.handles(payload.command))
      return shellPlugins.invoke(payload.command, payload.args ?? {});
    if (["invoke", "listen", "unlisten", "emit"].includes(type))
      return rendererHost.request(type, payload);
    throw new Error("Unsupported desktop request");
  };
  ipcMain.handle("colony:request", async (...args) => {
    try {
      return { ok: true, result: await dispatch(...args) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : error,
      };
    }
  });

  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    // Upstream keeps the app running on macOS so it can be reopened from the
    // dock or tray; elsewhere closing the window quits.
    if (process.platform === "darwin") {
      window.hide();
      return;
    }
    void quitApp();
  });
  quitApp = async () => {
    if (quitting) return;
    quitting = true;
    disposeWindowEvents();
    await shutdown();
    if (!window.isDestroyed()) window.destroy();
    app.quit();
  };

  await host.ready;
  // Native code (tray, notifications, reopen) asks for the main window here.
  const showId = host.nextId();
  host.on("event", (message) => {
    if (message.id === showId) revealWindow();
  });
  await host.request("listen", { event: SHOW_WINDOW_EVENT }, showId);

  if (smoke) {
    const relay = await host.request("invoke", {
      command: "get_default_relay_url",
      args: {},
    });
    if (typeof relay !== "string" || !relay)
      throw new Error("Native host returned no default relay URL");
  }

  await window.loadURL(devUrl || "colony://app/");
  await window.webContents.insertCSS(
    "[data-tauri-drag-region]{-webkit-app-region:drag} [data-tauri-drag-region] button,[data-tauri-drag-region] input,[data-tauri-drag-region] a{-webkit-app-region:no-drag}",
  );
  if (smoke) {
    console.log("colony-electron-smoke: ok");
    quitting = true;
    await shutdown();
    app.exit(0);
    return;
  }
  // Automated runs must never steal focus or keystrokes from the person
  // using this machine.
  if (process.env.COLONY_ELECTRON_BACKGROUND === "1") window.showInactive();
  else window.show();
}

async function shutdown() {
  if (!host) return;
  try {
    await host.close();
  } catch (error) {
    console.error(
      "Colony native host shutdown:",
      error instanceof Error ? error.message : error,
    );
  }
}

// Quitting from the dock menu or Cmd+Q must also stop the native host.
app.on("before-quit", (event) => {
  if (quitting || !host) return;
  event.preventDefault();
  void quitApp();
});
app.on("activate", () => revealWindow());
app.on("window-all-closed", () => app.quit());

if (primaryInstance)
  void boot().catch(async (error) => {
    console.error(
      "Colony Electron startup failed:",
      error instanceof Error ? error.message : error,
    );
    quitting = true;
    await shutdown();
    app.exit(1);
  });
