/** Agent mode is visible state only and grants no browser actions or credentials. */
export type BrowserControlOwner = "human" | "agent";

export type BrowserTabBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserTabState = {
  id: string;
  businessId: string;
  clientId: string | null;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  controlOwner: BrowserControlOwner;
  attached: boolean;
  visible: boolean;
  bounds: BrowserTabBounds | null;
};

export type BrowserHostEvent =
  | {
      type: "created" | "new-tab" | "state";
      tab: BrowserTabState;
      openedFrom?: string;
    }
  | { type: "closed"; tabId: string }
  | { type: "navigation-blocked"; tabId: string; reason: string }
  | { type: "download-blocked"; tabId: string; reason: string }
  | {
      type: "download";
      tabId: string;
      state: "started" | "completed" | "cancelled" | "interrupted";
    };

export type CreateBrowserTabOptions = {
  businessId: string;
  clientId?: string;
  url?: string;
};

export type BrowserHostApi = {
  createTab(options: CreateBrowserTabOptions): Promise<BrowserTabState>;
  listTabs(): Promise<BrowserTabState[]>;
  attach(
    tabId: string,
    bounds: BrowserTabBounds,
    visible?: boolean,
  ): Promise<BrowserTabState>;
  detach(tabId: string): Promise<BrowserTabState>;
  navigate(tabId: string, url: string): Promise<BrowserTabState>;
  back(tabId: string): Promise<BrowserTabState>;
  forward(tabId: string): Promise<BrowserTabState>;
  reload(tabId: string): Promise<BrowserTabState>;
  stop(tabId: string): Promise<BrowserTabState>;
  setControlOwner(
    tabId: string,
    controlOwner: BrowserControlOwner,
  ): Promise<BrowserTabState>;
  closeTab(tabId: string): Promise<{ closed: boolean }>;
  onEvent(callback: (event: BrowserHostEvent) => void): () => void;
};

declare global {
  interface Window {
    colonyBrowserHost?: BrowserHostApi;
  }
}

function requireBrowserHost(): BrowserHostApi {
  if (typeof window === "undefined" || !window.colonyBrowserHost) {
    throw new Error(
      "The embedded browser host is unavailable in this runtime.",
    );
  }
  return window.colonyBrowserHost;
}

/** Typed renderer boundary for the isolated Electron browser host. */
export const browserHost = {
  createTab: (options: CreateBrowserTabOptions) =>
    requireBrowserHost().createTab(options),
  listTabs: () => requireBrowserHost().listTabs(),
  attach: (tabId: string, bounds: BrowserTabBounds, visible = true) =>
    requireBrowserHost().attach(tabId, bounds, visible),
  detach: (tabId: string) => requireBrowserHost().detach(tabId),
  navigate: (tabId: string, url: string) =>
    requireBrowserHost().navigate(tabId, url),
  back: (tabId: string) => requireBrowserHost().back(tabId),
  forward: (tabId: string) => requireBrowserHost().forward(tabId),
  reload: (tabId: string) => requireBrowserHost().reload(tabId),
  stop: (tabId: string) => requireBrowserHost().stop(tabId),
  setControlOwner: (tabId: string, controlOwner: BrowserControlOwner) =>
    requireBrowserHost().setControlOwner(tabId, controlOwner),
  closeTab: (tabId: string) => requireBrowserHost().closeTab(tabId),
  onEvent: (callback: (event: BrowserHostEvent) => void) =>
    requireBrowserHost().onEvent(callback),
};
