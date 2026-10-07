import type { Page } from "@playwright/test";

import {
  checkedBounds,
  checkedUrl,
} from "../../../electron/browser-host-policy.mjs";
import type {
  BrowserHostApi,
  BrowserHostEvent,
  BrowserShortcutAction,
  BrowserTabBounds,
  BrowserTabState,
} from "../../../src/shared/api/browserHost";

/**
 * A stand-in for the Electron browser host (`window.colonyBrowserHost`) for
 * mock-bridge specs. There is no native view in a plain browser, so what it
 * models is the host's contract: tab lifecycle, history, events and the URL
 * rules. The URL rules are not copied: `checkedUrl`, `isAllowedWebUrl` and
 * `checkedBounds` are the real functions from `electron/browser-host-policy.mjs`,
 * called from the page through exposed functions, so a spec that passes here
 * binds the production policy. Real cookie, storage and download behaviour is
 * proven against real Electron in `tests/electron/browser-tab.spec.ts`.
 *
 * The fixture "site" is chosen by host name: `unreachable.test` fails to
 * resolve, `slow.test` stays loading until the spec finishes it, `files.test`
 * answers with a download instead of a page, anything else loads and takes its
 * title from the host and path.
 */

export type FakeCall = { op: string; [key: string]: unknown };

export type BrowserHostFakeControls = {
  calls: FakeCall[];
  tabs: () => BrowserTabState[];
  /** Deliver a host event to the app, as the preload does. */
  emit: (event: BrowserHostEvent) => void;
  /** A page script opened a window (`window.open`). */
  popup: (fromTabId: string, url: string) => void;
  /** A key pressed while the page, not the app, has focus. */
  shortcut: (tabId: string, action: BrowserShortcutAction) => void;
  finishLoading: (tabId: string) => void;
  crash: (tabId: string) => void;
  /** A link the host refused (`navigation-blocked`). */
  block: (tabId: string, reason: string) => void;
  /** The fake's own download of `fileName`, ending as `state`. */
  download: (
    tabId: string,
    fileName: string,
    state: "completed" | "interrupted" | "cancelled",
  ) => void;
  revealed: string[];
};

declare global {
  interface Window {
    __browserFake?: BrowserHostFakeControls;
    __browserPolicyUrl?: (
      url: string,
    ) => Promise<{ ok: true; href: string } | { ok: false; message: string }>;
    __browserPolicyBounds?: (
      bounds: unknown,
    ) => Promise<{ ok: true } | { ok: false; message: string }>;
  }
}

export async function installBrowserHostFake(
  page: Page,
  options: { contentSize?: { width: number; height: number } } = {},
) {
  const contentSize = options.contentSize ?? { width: 1440, height: 900 };
  await page.exposeFunction("__browserPolicyUrl", (url: string) => {
    try {
      return { ok: true as const, href: checkedUrl(url) };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  await page.exposeFunction("__browserPolicyBounds", (bounds: unknown) => {
    try {
      checkedBounds(bounds, { getContentBounds: () => contentSize });
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  await page.addInitScript(() => {
    type Tab = BrowserTabState & {
      history: string[];
      cursor: number;
      holding: boolean;
    };
    const tabs = new Map<string, Tab>();
    const calls: FakeCall[] = [];
    const revealed: string[] = [];
    const listeners = new Set<(event: BrowserHostEvent) => void>();
    let tabCounter = 0;
    let downloadCounter = 0;
    const completedDownloads = new Set<string>();

    const emit = (event: BrowserHostEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    const snapshot = (tab: Tab): BrowserTabState => ({
      id: tab.id,
      businessId: tab.businessId,
      clientId: tab.clientId,
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      canGoBack: tab.cursor > 0,
      canGoForward: tab.cursor < tab.history.length - 1,
      error: tab.error,
      controlOwner: tab.controlOwner,
      attached: tab.attached,
      visible: tab.visible,
      bounds: tab.bounds,
    });
    const sendState = (tab: Tab) => emit({ type: "state", tab: snapshot(tab) });
    const find = (tabId: string) => {
      const tab = tabs.get(tabId);
      if (!tab)
        throw new Error("Browser tab is unavailable to this app window");
      return tab;
    };
    const titleFor = (href: string) => {
      const url = new URL(href);
      return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
    };

    const startDownload = (
      tab: Tab,
      fileName: string,
      state: "completed" | "interrupted" | "cancelled",
    ) => {
      downloadCounter += 1;
      const downloadId = `download-${downloadCounter}`;
      emit({
        type: "download",
        tabId: tab.id,
        state: "started",
        downloadId,
        fileName,
      });
      if (state === "completed") completedDownloads.add(downloadId);
      emit({ type: "download", tabId: tab.id, state, downloadId, fileName });
    };

    const load = (tab: Tab, href: string, record: boolean) => {
      const host = new URL(href).hostname;
      if (host === "files.test") {
        // A navigation that becomes a download leaves the page where it was.
        startDownload(
          tab,
          decodeURIComponent(new URL(href).pathname.split("/").pop() || "file"),
          "completed",
        );
        tab.loading = false;
        sendState(tab);
        return;
      }
      tab.error = null;
      tab.url = href;
      tab.title = "";
      if (record) {
        tab.history = [...tab.history.slice(0, tab.cursor + 1), href];
        tab.cursor = tab.history.length - 1;
      }
      if (host === "unreachable.test") {
        tab.loading = false;
        tab.error = "Navigation failed (ERR_NAME_NOT_RESOLVED)";
        sendState(tab);
        return;
      }
      if (host === "slow.test") {
        tab.loading = true;
        tab.holding = true;
        sendState(tab);
        return;
      }
      tab.loading = false;
      tab.title = titleFor(href);
      sendState(tab);
    };

    const host: BrowserHostApi = {
      async createTab(options) {
        calls.push({ op: "createTab", ...options });
        if (!options.businessId) throw new Error("Invalid browser business id");
        let href: string | null = null;
        if (options.url !== undefined) {
          const checked = await window.__browserPolicyUrl?.(options.url);
          if (!checked?.ok)
            throw new Error(checked?.message ?? "Invalid browser URL");
          href = checked.href;
        }
        if (tabs.size >= 12) throw new Error("Browser tab limit reached");
        tabCounter += 1;
        const tab: Tab = {
          id: `fake-tab-${tabCounter}`,
          businessId: options.businessId,
          clientId: options.clientId ?? null,
          url: "about:blank",
          title: "",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
          controlOwner: "human",
          attached: false,
          visible: false,
          bounds: null,
          history: [],
          cursor: -1,
          holding: false,
        };
        tabs.set(tab.id, tab);
        emit({ type: "created", tab: snapshot(tab) });
        if (href) load(tab, href, true);
        return snapshot(tab);
      },
      async listTabs() {
        return [...tabs.values()].map(snapshot);
      },
      async attach(tabId, bounds: BrowserTabBounds, visible = true) {
        const tab = find(tabId);
        const checked = await window.__browserPolicyBounds?.(bounds);
        calls.push({ op: "attach", tabId, bounds, visible });
        if (!checked?.ok)
          throw new Error(checked?.message ?? "Invalid browser bounds");
        tab.attached = true;
        tab.visible = visible;
        tab.bounds = bounds;
        return snapshot(tab);
      },
      async detach(tabId) {
        const tab = find(tabId);
        calls.push({ op: "detach", tabId });
        tab.attached = false;
        tab.visible = false;
        tab.bounds = null;
        return snapshot(tab);
      },
      async navigate(tabId, url) {
        const tab = find(tabId);
        calls.push({ op: "navigate", tabId, url });
        const checked = await window.__browserPolicyUrl?.(url);
        if (!checked?.ok)
          throw new Error(checked?.message ?? "Invalid browser URL");
        load(tab, checked.href, true);
        return snapshot(tab);
      },
      async back(tabId) {
        const tab = find(tabId);
        calls.push({ op: "back", tabId });
        if (tab.cursor > 0) {
          tab.cursor -= 1;
          load(tab, tab.history[tab.cursor], false);
        }
        return snapshot(tab);
      },
      async forward(tabId) {
        const tab = find(tabId);
        calls.push({ op: "forward", tabId });
        if (tab.cursor < tab.history.length - 1) {
          tab.cursor += 1;
          load(tab, tab.history[tab.cursor], false);
        }
        return snapshot(tab);
      },
      async reload(tabId) {
        const tab = find(tabId);
        calls.push({ op: "reload", tabId });
        tab.error = null;
        load(tab, tab.url, false);
        return snapshot(tab);
      },
      async stop(tabId) {
        const tab = find(tabId);
        calls.push({ op: "stop", tabId });
        tab.loading = false;
        tab.holding = false;
        sendState(tab);
        return snapshot(tab);
      },
      async setControlOwner(tabId, controlOwner) {
        const tab = find(tabId);
        tab.controlOwner = controlOwner;
        return snapshot(tab);
      },
      async focus(tabId) {
        calls.push({ op: "focus", tabId });
        return snapshot(find(tabId));
      },
      async revealDownload(downloadId) {
        calls.push({ op: "revealDownload", downloadId });
        if (!completedDownloads.has(downloadId))
          throw new Error("That download is no longer available to show");
        revealed.push(downloadId);
        return { revealed: true };
      },
      async closeTab(tabId) {
        calls.push({ op: "closeTab", tabId });
        const tab = find(tabId);
        tabs.delete(tab.id);
        emit({ type: "closed", tabId });
        return { closed: true };
      },
      async closeBusiness(businessId) {
        calls.push({ op: "closeBusiness", businessId });
        let closedTabs = 0;
        for (const tab of [...tabs.values()]) {
          if (tab.businessId !== businessId) continue;
          tabs.delete(tab.id);
          emit({ type: "closed", tabId: tab.id });
          closedTabs += 1;
        }
        return { closedTabs };
      },
      async closeClient() {
        return { closedTabs: 0 };
      },
      async forgetBusiness() {
        return { forgottenProfiles: 0 };
      },
      async forgetClient() {
        return { forgottenProfiles: 0 };
      },
      onEvent(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    };

    const controls: BrowserHostFakeControls = {
      calls,
      revealed,
      tabs: () => [...tabs.values()].map(snapshot),
      emit,
      popup: (fromTabId, url) => {
        const parent = find(fromTabId);
        void window.__browserPolicyUrl?.(url).then(async (checked) => {
          if (!checked.ok) {
            emit({
              type: "navigation-blocked",
              tabId: fromTabId,
              reason: "unsupported-link",
            });
            return;
          }
          // As in the real host: the tab exists and is announced first, then
          // it loads, so the app never sees state for a tab it was not told of.
          const created = await host.createTab({
            businessId: parent.businessId,
          });
          emit({ type: "new-tab", tab: created, openedFrom: fromTabId });
          load(find(created.id), checked.href, true);
        });
      },
      shortcut: (tabId, action) => emit({ type: "shortcut", tabId, action }),
      finishLoading: (tabId) => {
        const tab = find(tabId);
        tab.loading = false;
        tab.holding = false;
        tab.title = titleFor(tab.url);
        sendState(tab);
      },
      crash: (tabId) => {
        const tab = find(tabId);
        tab.loading = false;
        tab.error = "Page process stopped (crashed)";
        sendState(tab);
      },
      block: (tabId, reason) =>
        emit({
          type: "navigation-blocked",
          tabId,
          reason: reason as "unsupported-link",
        }),
      download: (tabId, fileName, state) =>
        startDownload(find(tabId), fileName, state),
    };
    window.__browserFake = controls;
    window.colonyBrowserHost = host;
  });
}
