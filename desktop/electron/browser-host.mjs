import { randomUUID } from "node:crypto";
import { createBrowserSessionStore } from "./browser-session.mjs";
import {
  MAX_BROWSER_ERROR_LENGTH,
  MAX_BROWSER_TITLE_LENGTH,
  MAX_BROWSER_TABS,
  checkedBounds,
  checkedScopeId,
  browserShortcutAction,
  checkedUrl,
  isAllowedFrameUrl,
  isAllowedWebUrl,
  isRecord,
  navigationFailure,
} from "./browser-host-policy.mjs";

export const BROWSER_HOST_EVENT_CHANNEL = "colony:browser-event";

/** Input that means the person is using the page (not a mere pointer move). */
const HUMAN_INPUT_TYPES = new Set([
  "mouseDown",
  "mouseWheel",
  "rawKeyDown",
  "keyDown",
  "char",
  "touchStart",
]);

/**
 * The size a page has before the app shows it, and the size it keeps when the
 * dock that showed it closes. A page the app never mounted (an agent's page in a
 * channel nobody is looking at) still lays out at a real size, so its elements
 * can be found and clicked and it can be photographed.
 */
export const DEFAULT_TAB_BOUNDS = Object.freeze({
  x: 0,
  y: 0,
  width: 1_024,
  height: 768,
});

export function createBrowserHost({
  WebContentsView,
  /** Optional. Lets a page that is not on screen be drawn for a screenshot. */
  BrowserWindow,
  session,
  userDataPath,
  maxTabs = MAX_BROWSER_TABS,
  maxProfiles,
  maxActiveDownloads,
  maxDownloadBytes,
  /** The person's Downloads folder (`app.getPath("downloads")`). */
  downloadsPath,
  /** Reveal a saved download in the file manager (`shell.showItemInFolder`). */
  showItemInFolder,
  /** False when the kill switch is set: no tab can be created. */
  enabled = true,
  /** Page input arriving this long after an agent's own still belongs to it. */
  agentInputGraceMs = 100,
  platform = process.platform,
}) {
  const tabs = new Map();
  const tabsByContents = new Map();
  const pendingScopedCreates = new Map();
  let pendingCreates = 0;
  let navigationGate = () => ({ allow: true });
  let onHumanAction = () => {};
  const documentListeners = new Set();
  const closeListeners = new Set();
  const humanInputListeners = new Set();
  const privateListeners = new Set();
  const blockedNavigations = new Map();
  let stageTurn = Promise.resolve();

  function gate(tab, url, isMainFrame = true) {
    const verdict = navigationGate(tab.id, url, isMainFrame);
    if (!verdict.allow) {
      blockedNavigations.set(tab.id, verdict);
      // The refusal is the person's notice. Chromium then reports the cancelled
      // load as a failure (ERR_FAILED for a stopped redirect), which must not
      // also turn the page the person is looking at into an error page.
      if (isMainFrame) tab.gatedGeneration = tab.navigationGeneration;
      sendTabEvent(tab, "navigation-blocked", { reason: verdict.code });
    }
    return verdict.allow;
  }

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
      private: tab.private,
    };
  }

  /**
   * A page the system is not drawing (hidden behind the person's tab, the dock
   * closed, the Colony window hidden or minimized) produces no frames, and a
   * screenshot waits for a frame. The lease draws the page in a window that is
   * on screen but fully transparent and click-through, for the moment the
   * capture takes, then puts it back exactly where it was. A page that is
   * already on screen is left alone unless the caller asks for the stage.
   */
  async function lendRenderedView(tab, { force = false } = {}) {
    const none = { staged: false, release: async () => {} };
    if (!BrowserWindow || tab.webContents.isDestroyed()) return none;
    const owner = tab.ownerWindow;
    const showing =
      tab.attached &&
      tab.visible &&
      !owner.isDestroyed() &&
      owner.isVisible() &&
      !owner.isMinimized();
    if (showing && !force) return none;
    const previousTurn = stageTurn;
    let finishTurn = () => {};
    stageTurn = new Promise((resolve) => {
      finishTurn = resolve;
    });
    await previousTurn;
    if (!tabs.has(tab.id) || tab.webContents.isDestroyed()) {
      finishTurn();
      throw new Error("Browser tab closed");
    }
    const size = tab.bounds ?? DEFAULT_TAB_BOUNDS;
    const stage = new BrowserWindow({
      show: false,
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      useContentSize: true,
      frame: false,
      transparent: true,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
    });
    const previousBounds = tab.view.getBounds();
    let settleStaging = () => {};
    tab.staging = new Promise((resolve) => {
      settleStaging = resolve;
    });
    try {
      stage.setIgnoreMouseEvents(true);
      stage.setOpacity(0);
      stage.showInactive();
      if (tab.attached && !owner.isDestroyed())
        owner.contentView.removeChildView(tab.view);
      stage.contentView.addChildView(tab.view);
      tab.view.setBounds({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      });
      tab.view.setVisible(true);
      tab.stagedIn = stage;
    } catch (error) {
      tab.stagedIn = null;
      if (!stage.isDestroyed()) stage.destroy();
      settleStaging();
      tab.staging = null;
      finishTurn();
      throw error;
    }
    let released = false;
    return {
      staged: true,
      async release() {
        if (released) return;
        released = true;
        try {
          if (!stage.isDestroyed()) stage.contentView.removeChildView(tab.view);
        } catch {
          // The page was closed while it was on the stage.
        }
        tab.stagedIn = null;
        if (tabs.has(tab.id) && !tab.webContents.isDestroyed()) {
          if (tab.attached && !tab.ownerWindow.isDestroyed()) {
            tab.ownerWindow.contentView.addChildView(tab.view);
            tab.view.setBounds(tab.bounds ?? previousBounds);
            tab.view.setVisible(tab.visible);
          } else {
            tab.view.setBounds(previousBounds);
          }
        }
        if (!stage.isDestroyed()) stage.destroy();
        tab.staging = null;
        settleStaging();
        finishTurn();
      },
    };
  }

  /** What the broker sees of a tab: the page state plus when the person last used it. */
  function agentView(tab) {
    return { ...snapshot(tab), humanInputAt: tab.humanInputAt };
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
    maxProfiles,
    maxActiveDownloads,
    maxDownloadBytes,
    downloadsPath,
    showItemInFolder,
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

  function focusAppWindow(tab) {
    if (!tab.appWebContents.isDestroyed()) tab.appWebContents.focus();
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
      for (const listener of documentListeners) listener(tab.id);
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
        if (tab.gatedGeneration === tab.navigationGeneration) return;
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
      if (!gate(tab, details.url, details.isMainFrame)) {
        details.preventDefault();
        return;
      }
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
      if (!gate(tab, details.url, details.isMainFrame)) {
        details.preventDefault();
        return;
      }
      if (isAllowedFrameUrl(details.url, details.isMainFrame)) return;
      details.preventDefault();
      if (details.isMainFrame)
        updateError(tab, "Navigation redirected to an unsupported URL");
      else
        sendTabEvent(tab, "navigation-blocked", {
          reason: "unsupported-redirect",
        });
    });
    // The person pressing a key or the mouse in a page. The agent's own events
    // (sent while `agentInputs` is up) are not the person.
    contents.on("input-event", (_event, input) => {
      if (!tabs.has(tab.id) || tab.agentInputs > 0) return;
      if (!HUMAN_INPUT_TYPES.has(input.type)) return;
      tab.humanInputAt = Date.now();
      for (const listener of humanInputListeners) listener(tab.id);
    });
    // A native page view takes key events before the app window sees them, so
    // the few browser shortcuts (address bar, tabs, history, reload, dock) are
    // relayed to the app window and the page never receives them.
    contents.on("before-input-event", (event, input) => {
      const action = browserShortcutAction(input, platform);
      if (!action || !tabs.has(tab.id)) return;
      event.preventDefault();
      // Reload and history keep the page focused; the rest move the person to
      // the app's own controls, which only work if the app window has focus.
      if (!["reload", "back", "forward"].includes(action)) focusAppWindow(tab);
      sendTabEvent(tab, "shortcut", { action });
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (tab.controlOwner !== "human") {
        // A popup must never acquire a new ungated tab from an agent click.
        sendTabEvent(tab, "navigation-blocked", {
          reason: "agent-popup-denied",
        });
        return { action: "deny" };
      }
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
    const tabId = randomUUID();
    let reservedProfileHash = null;
    let pendingScope = null;
    try {
      const businessId = checkedScopeId(options.businessId, "business id");
      const clientId =
        options.clientId === undefined || options.clientId === null
          ? null
          : checkedScopeId(options.clientId, "client id");
      pendingScope = beginScopedCreate(businessId, clientId);
      const url = options.url === undefined ? null : checkedUrl(options.url);
      const browserProfile = await browserSessions.forScope(
        businessId,
        clientId,
        tabId,
      );
      reservedProfileHash = browserProfile.profileHash;
      if (appWebContents.isDestroyed() || ownerWindow.isDestroyed())
        throw new Error("The main app window is unavailable");
      const view = new WebContentsView({
        webPreferences: {
          session: browserProfile.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          // An agent works in a page nobody is looking at. Its timers and
          // layout run at full speed whether or not the page is on screen.
          backgroundThrottling: false,
        },
      });
      view.setBounds({ ...DEFAULT_TAB_BOUNDS });
      const tab = {
        id: tabId,
        businessId,
        clientId,
        profileHash: browserProfile.profileHash,
        url: url || "about:blank",
        title: "",
        error: null,
        navigationGeneration: 0,
        gatedGeneration: null,
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
        staging: null,
        stagedIn: null,
        private: false,
        agentInputs: 0,
        humanInputAt: null,
      };
      tabs.set(tab.id, tab);
      tabsByContents.set(tab.webContents.id, tab);
      reservedProfileHash = null;
      wireWebContents(tab);
      emit(appWebContents, {
        type: options.openedFrom ? "new-tab" : "created",
        tab: snapshot(tab),
        openedFrom: options.openedFrom,
        ...(options.background ? { background: true } : {}),
      });
      if (url)
        void loadTab(tab, url).catch((error) => {
          if (tabs.has(tab.id)) updateError(tab, navigationFailure(error));
        });
      return snapshot(tab);
    } catch (error) {
      const tab = tabs.get(tabId);
      if (tab) closeRecord(tab);
      else if (reservedProfileHash)
        browserSessions.releaseTab(reservedProfileHash, tabId);
      throw error;
    } finally {
      if (pendingScope) finishScopedCreate(pendingScope);
      pendingCreates -= 1;
    }
  }

  async function loadTab(tab, url) {
    const safeUrl = checkedUrl(url);
    if (!gate(tab, safeUrl)) throw new Error("Browser navigation was blocked");
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
        tab.gatedGeneration === generation ||
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
    if (!visible && tab.attached && tab.visible && tab.webContents.isFocused())
      focusAppWindow(tab);
    if (visible) {
      for (const other of tabs.values()) {
        if (other.id === tab.id || other.ownerWindow !== tab.ownerWindow)
          continue;
        if (other.attached && other.visible) {
          if (other.webContents.isFocused()) focusAppWindow(other);
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
    if (tab.webContents.isFocused()) focusAppWindow(tab);
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
    for (const listener of closeListeners) listener(tab.id);
    blockedNavigations.delete(tab.id);
    if (tab.attached && !tab.ownerWindow.isDestroyed())
      tab.ownerWindow.contentView.removeChildView(tab.view);
    if (tab.stagedIn) {
      try {
        if (!tab.stagedIn.isDestroyed())
          tab.stagedIn.contentView.removeChildView(tab.view);
      } catch {
        // Already gone with its window.
      }
    }
    browserSessions.cancelTabDownloads(tab.id);
    browserSessions.releaseTab(tab.profileHash, tab.id);
    tabs.delete(tab.id);
    tabsByContents.delete(tab.webContents.id);
    sendTabEvent(tab, "closed");
    if (!tab.webContents.isDestroyed()) tab.webContents.destroy();
  }

  function beginScopedCreate(businessId, clientId) {
    const key = JSON.stringify([businessId, clientId]);
    let pending = pendingScopedCreates.get(key);
    if (!pending) {
      pending = { businessId, clientId, count: 0, waiters: [] };
      pendingScopedCreates.set(key, pending);
    }
    pending.count += 1;
    return pending;
  }

  function finishScopedCreate(pending) {
    pending.count -= 1;
    if (pending.count !== 0) return;
    pendingScopedCreates.delete(
      JSON.stringify([pending.businessId, pending.clientId]),
    );
    for (const resolve of pending.waiters) resolve();
  }

  function waitForAllCreates() {
    return Promise.all(
      [...pendingScopedCreates.values()].map(
        (entry) =>
          new Promise((resolve) => {
            entry.waiters.push(resolve);
          }),
      ),
    );
  }

  function waitForScopedCreates(businessId, clientId, allClients = false) {
    const pending = [...pendingScopedCreates.values()].filter(
      (entry) =>
        entry.businessId === businessId &&
        (allClients || entry.clientId === clientId),
    );
    return Promise.all(
      pending.map(
        (entry) =>
          new Promise((resolve) => {
            entry.waiters.push(resolve);
          }),
      ),
    );
  }

  async function handleRequest(ownerWindow, sender, action, payload) {
    if (!sender || sender.isDestroyed())
      throw new Error("Desktop window is closed");
    if (typeof action !== "string" || !isRecord(payload))
      throw new Error("Invalid browser request");

    if (action === "create") {
      if (!enabled) throw new Error("The embedded browser is turned off");
      if (!ownerWindow || ownerWindow.isDestroyed())
        throw new Error("The main app window is unavailable");
      return createTabInternal(sender, ownerWindow, payload);
    }
    if (action === "list") {
      return [...tabs.values()]
        .filter((tab) => tab.appWebContents.id === sender.id)
        .map(snapshot);
    }

    if (action === "close-business" || action === "close-client") {
      const businessId = checkedScopeId(payload.businessId, "business id");
      const clientId =
        action === "close-client"
          ? checkedScopeId(payload.clientId, "client id")
          : null;
      await waitForScopedCreates(
        businessId,
        clientId,
        action === "close-business",
      );
      let closedTabs = 0;
      for (const tab of [...tabs.values()]) {
        if (
          tab.businessId !== businessId ||
          (clientId !== null && tab.clientId !== clientId)
        )
          continue;
        closeRecord(tab);
        closedTabs += 1;
      }
      return { closedTabs };
    }

    if (action === "reveal-download")
      return browserSessions.revealDownload(payload.downloadId);

    if (action === "forget-business") {
      const businessId = checkedScopeId(payload.businessId, "business id");
      await waitForScopedCreates(businessId, null, true);
      return browserSessions.forgetBusiness(businessId);
    }

    if (action === "forget-all") {
      // Sign out and account delete: every page of every business ends first.
      await waitForAllCreates();
      for (const tab of [...tabs.values()]) closeRecord(tab);
      return browserSessions.forgetAll();
    }

    if (action === "forget-client") {
      const businessId = checkedScopeId(payload.businessId, "business id");
      const clientId = checkedScopeId(payload.clientId, "client id");
      await waitForScopedCreates(businessId, clientId);
      return browserSessions.forgetClient(businessId, clientId);
    }

    const tab = findOwnedTab(payload.tabId, sender.id);
    // A page on the capture stage returns to the window first, so a show or
    // hide from the app is applied to a page that is back where it belongs.
    if (["attach", "detach"].includes(action)) await tab.staging;
    if (
      [
        "navigate",
        "back",
        "forward",
        "reload",
        "stop",
        "close",
        "control-owner",
      ].includes(action)
    ) {
      onHumanAction(tab.id);
    }
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
      case "focus":
        tab.webContents.focus();
        return snapshot(tab);
      case "set-private":
        if (typeof payload.private !== "boolean")
          throw new Error("Invalid browser privacy setting");
        tab.private = payload.private;
        sendState(tab);
        if (tab.private)
          for (const listener of privateListeners) listener(tab.id);
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

  /** Main-process-only adapter. Never expose this object through preload. */
  const agentAdapter = {
    downloadDirectory: () => downloadsPath,
    rememberDownload: (tabId, id, destination, name, bytes) =>
      browserSessions.rememberAgentDownload(
        tabs.get(tabId),
        id,
        destination,
        name,
        bytes,
      ),
    tabIds: () => [...tabs.keys()],
    listTabs: (businessId, clientId) =>
      [...tabs.values()]
        .filter(
          (tab) => tab.businessId === businessId && tab.clientId === clientId,
        )
        .map(agentView),
    markAgentInput(id, delta) {
      const tab = tabs.get(id);
      if (!tab) return;
      if (delta > 0) {
        tab.agentInputs += delta;
        return;
      }
      // The page may report the agent's own key or click a moment after the
      // command returned; that late report is not the person.
      const timer = setTimeout(() => {
        tab.agentInputs = Math.max(0, tab.agentInputs + delta);
      }, agentInputGraceMs);
      timer.unref?.();
    },
    onHumanInput(callback) {
      humanInputListeners.add(callback);
      return () => humanInputListeners.delete(callback);
    },
    onTabPrivate(callback) {
      privateListeners.add(callback);
      return () => privateListeners.delete(callback);
    },
    renderLease: (id, options) => {
      const tab = tabs.get(id);
      if (!tab) throw new Error("Browser tab closed");
      return lendRenderedView(tab, options);
    },
    getTab: (id) => (tabs.has(id) ? agentView(tabs.get(id)) : null),
    webContents: (id) => tabs.get(id)?.webContents,
    session: (id) => tabs.get(id)?.webContents.session,
    ownedBy: (id, senderId) => tabs.get(id)?.appWebContents.id === senderId,
    async createTab({ businessId, clientId, primaryTabId }) {
      const primary = tabs.get(primaryTabId);
      if (
        !primary ||
        primary.businessId !== businessId ||
        primary.clientId !== (clientId ?? null)
      )
        throw new Error("Browser task scope is unavailable");
      // `openedFrom` makes the app adopt the tab as a work area tab beside its
      // opener, so the person sees every page the agent opens.
      return createTabInternal(primary.appWebContents, primary.ownerWindow, {
        businessId,
        clientId,
        openedFrom: primaryTabId,
        // The person is not looking: the app adds the tab and leaves the view be.
        background: true,
      });
    },
    closeTab(id) {
      const tab = tabs.get(id);
      if (tab) closeRecord(tab);
    },
    async loadUrl(id, url) {
      const tab = tabs.get(id);
      if (!tab) throw new Error("Browser tab closed");
      const result = await loadTab(tab, url);
      if (result.error && !blockedNavigations.has(id))
        throw new Error("Browser navigation failed");
      return result;
    },
    history(id, action) {
      const tab = tabs.get(id);
      if (!tab) throw new Error("Browser tab closed");
      const history = tab.webContents.navigationHistory;
      const offset = action === "back" ? -1 : action === "forward" ? 1 : 0;
      const target =
        offset === 0
          ? snapshot(tab).url
          : history.getAllEntries()[history.getActiveIndex() + offset]?.url;
      if (!target || !gate(tab, target)) return;
      if (offset === 0) return loadTab(tab, target);
      if (offset === -1 && history.canGoBack()) history.goBack();
      if (offset === 1 && history.canGoForward()) history.goForward();
    },
    stop(id) {
      const tab = tabs.get(id);
      if (tab && !tab.webContents.isDestroyed()) tab.webContents.stop();
    },
    setControlOwner(id, owner) {
      const tab = tabs.get(id);
      if (!tab) throw new Error("Browser tab closed");
      if (!["human", "agent", "agent-awaiting-confirmation"].includes(owner))
        throw new Error("Invalid controller");
      tab.controlOwner = owner;
      sendState(tab);
    },
    setNavigationGate(callback) {
      navigationGate = callback;
    },
    setHumanActionHandler(callback) {
      onHumanAction = callback;
    },
    onDocumentChanged(callback) {
      documentListeners.add(callback);
      return () => documentListeners.delete(callback);
    },
    onTabClosed(callback) {
      closeListeners.add(callback);
      return () => closeListeners.delete(callback);
    },
    consumeBlocked(id) {
      const verdict = blockedNavigations.get(id);
      blockedNavigations.delete(id);
      return verdict;
    },
  };
  return { handleRequest, disposeWindow, disposeAll, agentAdapter };
}
