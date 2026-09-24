import { randomUUID } from "node:crypto";
import { createBrowserSessionStore } from "./browser-session.mjs";
import {
  MAX_BROWSER_ERROR_LENGTH,
  MAX_BROWSER_TITLE_LENGTH,
  MAX_BROWSER_TABS,
  checkedBounds,
  checkedScopeId,
  checkedUrl,
  isAllowedFrameUrl,
  isAllowedWebUrl,
  isRecord,
  navigationFailure,
} from "./browser-host-policy.mjs";

export const BROWSER_HOST_EVENT_CHANNEL = "colony:browser-event";

export function createBrowserHost({
  WebContentsView,
  session,
  userDataPath,
  maxTabs = MAX_BROWSER_TABS,
  maxActiveDownloads,
  maxDownloadBytes,
}) {
  const tabs = new Map();
  const tabsByContents = new Map();
  let pendingCreates = 0;

  function emit(webContents, event) {
    if (webContents && !webContents.isDestroyed())
      webContents.send(BROWSER_HOST_EVENT_CHANNEL, event);
  }

  function snapshot(tab) {
    const alive = !tab.webContents.isDestroyed();
    return {
      id: tab.id,
      businessId: tab.businessId,
      clientId: tab.clientId,
      url: alive ? tab.webContents.getURL() || tab.url : tab.url,
      title: alive
        ? tab.webContents.getTitle().slice(0, MAX_BROWSER_TITLE_LENGTH)
        : tab.title,
      loading: alive ? tab.webContents.isLoading() : false,
      canGoBack: alive && tab.webContents.navigationHistory.canGoBack(),
      canGoForward: alive && tab.webContents.navigationHistory.canGoForward(),
      error: tab.error,
      controlOwner: tab.controlOwner,
      attached: tab.attached,
      visible: tab.visible,
      bounds: tab.bounds,
    };
  }

  function sendState(tab) {
    emit(tab.appWebContents, { type: "state", tab: snapshot(tab) });
  }

  function sendTabEvent(tab, type, detail = {}) {
    emit(tab.appWebContents, { type, tabId: tab.id, ...detail });
  }

  const browserSessions = createBrowserSessionStore({
    session,
    userDataPath,
    maxActiveDownloads,
    maxDownloadBytes,
    getTabForContents: (contentsId) => tabsByContents.get(contentsId),
    emitTabEvent: sendTabEvent,
    hasTab: (tabId) => tabs.has(tabId),
  });

  function updateError(tab, message) {
    if (!tabs.has(tab.id)) return;
    tab.error = String(message).slice(0, MAX_BROWSER_ERROR_LENGTH);
    tab.loading = false;
    sendState(tab);
  }

  function beginRendererNavigation(tab, url) {
    tab.navigationGeneration += 1;
    tab.expectedNavigationUrl = url;
    tab.activeNavigationUrl = url;
    tab.activeNavigationGeneration = tab.navigationGeneration;
  }

  function findOwnedTab(id, senderId) {
    if (typeof id !== "string") throw new Error("Invalid browser tab id");
    const tab = tabs.get(id);
    if (!tab || tab.appWebContents.id !== senderId)
      throw new Error("Browser tab is unavailable to this app window");
    if (tab.webContents.isDestroyed())
      throw new Error("Browser tab has been closed");
    return tab;
  }

  function wireWebContents(tab) {
    const contents = tab.webContents;
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument || !tabs.has(tab.id))
        return;
      if (tab.expectedNavigationUrl !== details.url) {
        tab.navigationGeneration += 1;
      }
      tab.expectedNavigationUrl = null;
      tab.activeNavigationUrl = details.url;
      tab.activeNavigationGeneration = tab.navigationGeneration;
      tab.error = null;
      sendState(tab);
    });
    contents.on("did-start-loading", () => {
      if (!tabs.has(tab.id)) return;
      tab.loading = true;
      sendState(tab);
    });
    contents.on("did-stop-loading", () => {
      if (!tabs.has(tab.id)) return;
      tab.loading = false;
      sendState(tab);
    });
    contents.on("did-navigate", (_event, url) => {
      if (!tabs.has(tab.id)) return;
      if (
        tab.activeNavigationGeneration === tab.navigationGeneration &&
        tab.activeNavigationUrl &&
        tab.activeNavigationUrl !== url
      )
        return;
      tab.url = url;
      tab.error = null;
      tab.activeNavigationUrl = null;
      tab.activeNavigationGeneration = null;
      sendState(tab);
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      if (!tabs.has(tab.id)) return;
      tab.url = url;
      sendState(tab);
    });
    contents.on("did-redirect-navigation", (details) => {
      if (
        !details.isMainFrame ||
        !tabs.has(tab.id) ||
        tab.activeNavigationGeneration !== tab.navigationGeneration
      )
        return;
      tab.url = details.url;
      tab.activeNavigationUrl = details.url;
      sendState(tab);
    });
    contents.on("page-title-updated", (_event, title) => {
      if (!tabs.has(tab.id)) return;
      tab.title = title.slice(0, MAX_BROWSER_TITLE_LENGTH);
      sendState(tab);
    });
    contents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || !tabs.has(tab.id)) return;
        if (tab.activeNavigationGeneration !== tab.navigationGeneration) return;
        if (tab.activeNavigationUrl && tab.activeNavigationUrl !== validatedUrl)
          return;
        updateError(tab, navigationFailure(new Error(errorDescription)));
      },
    );
    contents.on("render-process-gone", (_event, details) => {
      if (!tabs.has(tab.id)) return;
      updateError(tab, `Page process stopped (${details.reason})`);
    });
    contents.on("unresponsive", () => {
      if (tabs.has(tab.id)) updateError(tab, "Page is not responding");
    });
    contents.on("will-frame-navigate", (details) => {
      if (isAllowedFrameUrl(details.url, details.isMainFrame)) {
        if (details.isMainFrame) beginRendererNavigation(tab, details.url);
        return;
      }
      details.preventDefault();
      sendTabEvent(tab, "navigation-blocked", { reason: "unsupported-url" });
      if (details.isMainFrame)
        updateError(tab, "Navigation to an unsupported URL was blocked");
    });
    contents.on("will-redirect", (details) => {
      if (isAllowedFrameUrl(details.url, details.isMainFrame)) return;
      details.preventDefault();
      if (details.isMainFrame)
        updateError(tab, "Navigation redirected to an unsupported URL");
      else
        sendTabEvent(tab, "navigation-blocked", {
          reason: "unsupported-redirect",
        });
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedWebUrl(url)) {
        sendTabEvent(tab, "navigation-blocked", { reason: "unsupported-link" });
        return { action: "deny" };
      }
      const childUrl = checkedUrl(url);
      void createTabInternal(tab.appWebContents, tab.ownerWindow, {
        businessId: tab.businessId,
        clientId: tab.clientId,
        url: childUrl,
        openedFrom: tab.id,
      }).catch((error) => {
        const reason =
          error instanceof Error &&
          error.message === "Browser tab limit reached"
            ? "tab-limit"
            : "tab-open-failed";
        sendTabEvent(tab, "navigation-blocked", { reason });
      });
      return { action: "deny" };
    });
  }

  async function createTabInternal(appWebContents, ownerWindow, options) {
    if (tabs.size + pendingCreates >= maxTabs)
      throw new Error("Browser tab limit reached");
    pendingCreates += 1;
    try {
      const businessId = checkedScopeId(options.businessId, "business id");
      const clientId =
        options.clientId === undefined || options.clientId === null
          ? null
          : checkedScopeId(options.clientId, "client id");
      const url = options.url === undefined ? null : checkedUrl(options.url);
      const browserSession = await browserSessions.forScope(
        businessId,
        clientId,
      );
      if (appWebContents.isDestroyed() || ownerWindow.isDestroyed())
        throw new Error("The main app window is unavailable");
      const view = new WebContentsView({
        webPreferences: {
          session: browserSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
        },
      });
      const tab = {
        id: randomUUID(),
        businessId,
        clientId,
        url: url || "about:blank",
        title: "",
        error: null,
        navigationGeneration: 0,
        expectedNavigationUrl: null,
        activeNavigationUrl: null,
        activeNavigationGeneration: null,
        controlOwner: "human",
        ownerWindow,
        appWebContents,
        view,
        webContents: view.webContents,
        attached: false,
        visible: false,
        bounds: null,
      };
      tabs.set(tab.id, tab);
      tabsByContents.set(tab.webContents.id, tab);
      wireWebContents(tab);
      emit(appWebContents, {
        type: options.openedFrom ? "new-tab" : "created",
        tab: snapshot(tab),
        openedFrom: options.openedFrom,
      });
      if (url)
        void loadTab(tab, url).catch((error) => {
          if (tabs.has(tab.id)) updateError(tab, navigationFailure(error));
        });
      return snapshot(tab);
    } finally {
      pendingCreates -= 1;
    }
  }

  async function loadTab(tab, url) {
    const safeUrl = checkedUrl(url);
    const generation = tab.navigationGeneration + 1;
    tab.navigationGeneration = generation;
    tab.expectedNavigationUrl = safeUrl;
    tab.activeNavigationUrl = safeUrl;
    tab.activeNavigationGeneration = generation;
    tab.error = null;
    sendState(tab);
    try {
      await tab.webContents.loadURL(safeUrl);
      return snapshot(tab);
    } catch (error) {
      const message = navigationFailure(error);
      if (
        generation !== tab.navigationGeneration ||
        message.includes("ERR_ABORTED")
      )
        return snapshot(tab);
      updateError(tab, message);
      return snapshot(tab);
    }
  }

  function attachTab(tab, boundsValue, visible = true) {
    if (typeof visible !== "boolean")
      throw new Error("Invalid browser visibility");
    const bounds = checkedBounds(boundsValue, tab.ownerWindow);
    if (!tab.attached) tab.ownerWindow.contentView.addChildView(tab.view);
    tab.attached = true;
    tab.bounds = bounds;
    if (visible) {
      for (const other of tabs.values()) {
        if (other.id === tab.id || other.ownerWindow !== tab.ownerWindow)
          continue;
        if (other.attached && other.visible) {
          other.view.setVisible(false);
          other.visible = false;
          sendState(other);
        }
      }
    }
    tab.view.setBounds(bounds);
    tab.view.setVisible(visible);
    tab.visible = visible;
    sendState(tab);
    return snapshot(tab);
  }

  function detachTab(tab) {
    if (tab.attached && !tab.ownerWindow.isDestroyed())
      tab.ownerWindow.contentView.removeChildView(tab.view);
    tab.attached = false;
    tab.visible = false;
    tab.bounds = null;
    sendState(tab);
    return snapshot(tab);
  }

  function closeRecord(tab) {
    if (!tabs.has(tab.id)) return;
    if (tab.attached && !tab.ownerWindow.isDestroyed())
      tab.ownerWindow.contentView.removeChildView(tab.view);
    browserSessions.cancelTabDownloads(tab.id);
    tabs.delete(tab.id);
    tabsByContents.delete(tab.webContents.id);
    sendTabEvent(tab, "closed");
    if (!tab.webContents.isDestroyed()) tab.webContents.destroy();
  }

  async function handleRequest(ownerWindow, sender, action, payload) {
    if (!sender || sender.isDestroyed())
      throw new Error("Desktop window is closed");
    if (typeof action !== "string" || !isRecord(payload))
      throw new Error("Invalid browser request");

    if (action === "create") {
      if (!ownerWindow || ownerWindow.isDestroyed())
        throw new Error("The main app window is unavailable");
      return createTabInternal(sender, ownerWindow, payload);
    }
    if (action === "list") {
      return [...tabs.values()]
        .filter((tab) => tab.appWebContents.id === sender.id)
        .map(snapshot);
    }

    const tab = findOwnedTab(payload.tabId, sender.id);
    switch (action) {
      case "attach":
        return attachTab(tab, payload.bounds, payload.visible ?? true);
      case "detach":
        return detachTab(tab);
      case "navigate":
        return loadTab(tab, payload.url);
      case "back":
        if (tab.webContents.navigationHistory.canGoBack()) {
          tab.navigationGeneration += 1;
          tab.expectedNavigationUrl = null;
          tab.activeNavigationUrl = null;
          tab.activeNavigationGeneration = tab.navigationGeneration;
          tab.webContents.navigationHistory.goBack();
        }
        return snapshot(tab);
      case "forward":
        if (tab.webContents.navigationHistory.canGoForward()) {
          tab.navigationGeneration += 1;
          tab.expectedNavigationUrl = null;
          tab.activeNavigationUrl = null;
          tab.activeNavigationGeneration = tab.navigationGeneration;
          tab.webContents.navigationHistory.goForward();
        }
        return snapshot(tab);
      case "reload":
        tab.navigationGeneration += 1;
        tab.expectedNavigationUrl = null;
        tab.activeNavigationUrl = null;
        tab.activeNavigationGeneration = tab.navigationGeneration;
        tab.webContents.reload();
        return snapshot(tab);
      case "stop":
        tab.navigationGeneration += 1;
        tab.expectedNavigationUrl = null;
        tab.activeNavigationUrl = null;
        tab.activeNavigationGeneration = null;
        tab.webContents.stop();
        return snapshot(tab);
      case "control-owner":
        if (!["human", "agent"].includes(payload.controlOwner))
          throw new Error("Invalid browser control owner");
        tab.controlOwner = payload.controlOwner;
        sendState(tab);
        return snapshot(tab);
      case "close":
        closeRecord(tab);
        return { closed: true };
      default:
        throw new Error("Unsupported browser operation");
    }
  }

  function disposeWindow(window) {
    for (const tab of [...tabs.values()]) {
      if (tab.ownerWindow === window) closeRecord(tab);
    }
  }

  function disposeAll() {
    for (const tab of [...tabs.values()]) closeRecord(tab);
  }

  return { handleRequest, disposeWindow, disposeAll };
}
