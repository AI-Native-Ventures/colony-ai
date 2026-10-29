import { mkdirSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, WebContentsView, app, session } from "electron";

import {
  BROWSER_TAB_USER_AGENT,
  createBrowserHost,
} from "../../electron/browser-host.mjs";

const home = process.env.HOME;
if (!home || !path.isAbsolute(home))
  throw new Error("The OAuth popup fixture needs a throwaway HOME");

const userDataPath = path.join(home, "user-data");
const downloadsPath = path.join(home, "Downloads");
const appWindowUserAgent = app.userAgentFallback;
mkdirSync(userDataPath, { recursive: true });
mkdirSync(downloadsPath, { recursive: true });
app.setPath("userData", userDataPath);
app.setPath("downloads", downloadsPath);
app.disableHardwareAcceleration();

const popupRecords = [];
let state;

app.whenReady().then(async () => {
  app.userAgentFallback = BROWSER_TAB_USER_AGENT;
  const ownerWindow = new BrowserWindow({
    width: 1_000,
    height: 760,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  ownerWindow.webContents.setUserAgent(appWindowUserAgent);
  app.on("browser-window-created", (_event, window) => {
    if (window === ownerWindow) return;
    const record = { window, closed: false };
    window.once("closed", () => {
      record.closed = true;
    });
    popupRecords.push(record);
  });

  const host = createBrowserHost({
    WebContentsView,
    BrowserWindow,
    session,
    userDataPath,
    downloadsPath,
  });
  const humanInputTabs = [];
  host.agentAdapter.onHumanInput((tabId) => humanInputTabs.push(tabId));
  state = {
    host,
    ownerWindow,
    ready: false,
    popupSnapshot() {
      return popupRecords.map(({ window, closed }) => {
        const nativeDestroyed = window.isDestroyed();
        return {
          closed: closed || nativeDestroyed,
          nativeDestroyed,
          webContentsDestroyed:
            nativeDestroyed || window.webContents.isDestroyed(),
          visible: !nativeDestroyed && window.isVisible(),
          bounds: nativeDestroyed ? null : window.getBounds(),
          parented:
            !nativeDestroyed && window.getParentWindow() === ownerWindow,
        };
      });
    },
    sendPopupKeyInput() {
      const popup = [...popupRecords]
        .reverse()
        .find(({ window }) => !window.isDestroyed());
      if (!popup) throw new Error("OAuth popup is unavailable");
      popup.window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "A",
      });
    },
    humanInputTabs() {
      return [...humanInputTabs];
    },
    closePopups() {
      for (const { window } of popupRecords) {
        if (!window.isDestroyed()) window.destroy();
      }
    },
    closeWindows() {
      this.closePopups();
      if (!ownerWindow.isDestroyed()) ownerWindow.destroy();
    },
    quit() {
      app.quit();
    },
    async popupPageFlags() {
      const popup = [...popupRecords]
        .reverse()
        .find(({ window }) => !window.isDestroyed());
      if (!popup) return null;
      return popup.window.webContents.executeJavaScript(`({
        opener: document.documentElement.dataset.opener === "yes",
        sharedCookie: document.documentElement.dataset.sharedCookie === "yes",
        uaHasElectron: document.documentElement.dataset.uaHasElectron === "yes",
        uaHasColony: document.documentElement.dataset.uaHasColony === "yes",
        chromeVersion: document.documentElement.dataset.chromeVersion
      })`);
    },
  };
  Object.defineProperty(globalThis, "__c3BrowserOAuth", {
    configurable: false,
    enumerable: false,
    value: state,
  });

  await ownerWindow.loadURL("about:blank");
  state.ready = true;
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => state?.host.disposeAll());
