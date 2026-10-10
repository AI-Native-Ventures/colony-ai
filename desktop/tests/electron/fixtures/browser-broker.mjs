// Dedicated fixture app, not a packaged build and not an owner profile.
import {
  BrowserWindow,
  WebContentsView,
  app,
  ipcMain,
  session,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createBrowserHost } from "../../../electron/browser-host.mjs";
import {
  createElectronBrowserAgentHost,
  createBrowserBrokerIpcHandler,
  BROWSER_BROKER_EVENT_CHANNEL,
} from "../../../electron/browser-broker/electron-host.mjs";
import { browserSessionCredential } from "../../../electron/browser-broker/session-identity.mjs";
app.setPath("userData", process.env.COLONY_ELECTRON_USER_DATA);
app.commandLine.appendSwitch("disable-quic");
async function boot() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: {
      preload: fileURLToPath(
        new URL("../../../electron/preload.cjs", import.meta.url),
      ),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const browser = createBrowserHost({
    WebContentsView,
    session,
    userDataPath: app.getPath("userData"),
    downloadsPath: path.join(app.getPath("userData"), "downloads"),
  });
  const fixtureOrigin = new URL(process.env.COLONY_BROWSER_FIXTURE_URL);
  const host = await createElectronBrowserAgentHost({
    browserHost: browser,
    uploadStagingRoot: path.join(app.getPath("userData"), "uploads"),
    chooseFile: async () =>
      process.env.COLONY_BROWSER_FIXTURE_UPLOAD_PATH ?? null,
    enabled: process.env.COLONY_BROWSER_AGENT === "1",
    fixturePrivateExceptions: [
      `${fixtureOrigin.hostname}:${fixtureOrigin.port}`,
    ],
  });
  const appUrl = new URL("./browser-broker.html", import.meta.url).href;
  const windows = new Map([[window.webContents.id, { label: "main", window }]]);
  const trusted = (url) => url === appUrl;
  ipcMain.handle(
    "colony:browser-broker",
    createBrowserBrokerIpcHandler({ windows, trusted, getHost: () => host }),
  );
  ipcMain.handle("colony:browser", async (event, action, payload) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error("Untrusted browser host caller");
    try {
      return {
        ok: true,
        result: await browser.handleRequest(
          window,
          event.sender,
          action,
          payload,
        ),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  host.onEvent((event) =>
    window.webContents.send(BROWSER_BROKER_EVENT_CHANNEL, event),
  );
  // Only Playwright's main test connection can request a scoped fixture credential.
  // The master stays in the fixture main process, with no renderer IPC route.
  globalThis.colonyBrowserFixture = {
    browser,
    credential: (context) => ({
      socketPath: host.env.COLONY_BROWSER_BROKER_SOCKET,
      secret: browserSessionCredential(
        host.env.COLONY_BROWSER_BROKER_MASTER,
        context,
      ),
    }),
  };
  await window.loadURL(appUrl);
  window.showInactive();
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void host.stop().then(() => {
      browser.disposeAll();
      app.quit();
    });
  });
}
void boot().catch((error) => {
  console.error(error);
  app.exit(1);
});
