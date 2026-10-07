/** Agent actions require a separate main-owned, revocable task grant. */
export type BrowserControlOwner =
  | "human"
  | "agent"
  | "agent-awaiting-confirmation";

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

/** Keys the host relays from a focused page to the app window. */
export type BrowserShortcutAction =
  | "focus-address"
  | "new-tab"
  | "close-tab"
  | "reload"
  | "back"
  | "forward"
  | "toggle-dock";

export type BrowserNavigationBlockReason =
  | "unsupported-url"
  | "unsupported-link"
  | "unsupported-redirect"
  | "tab-limit"
  | "tab-open-failed"
  | "agent-popup-denied"
  | "origin_approval_required"
  | "private_network_denied"
  | "scheme_denied"
  | "invalid_input";

export type BrowserDownloadBlockReason =
  | "download-limit"
  | "download-size-limit"
  | "save-failed";

export type BrowserDownloadState =
  | "started"
  | "completed"
  | "cancelled"
  | "interrupted";

export type BrowserHostEvent =
  | {
      type: "created" | "new-tab" | "state";
      tab: BrowserTabState;
      openedFrom?: string;
    }
  | { type: "closed"; tabId: string }
  | {
      type: "navigation-blocked";
      tabId: string;
      reason: BrowserNavigationBlockReason;
    }
  | {
      type: "download-blocked";
      tabId: string;
      reason: BrowserDownloadBlockReason;
    }
  | {
      type: "download";
      tabId: string;
      state: BrowserDownloadState;
      /** Opaque id; pass it to `revealDownload` once the download completed. */
      downloadId: string;
      /** The name the file was saved under in the Downloads folder. */
      fileName: string;
    }
  | { type: "shortcut"; tabId: string; action: BrowserShortcutAction };

export type CreateBrowserTabOptions = {
  businessId: string;
  clientId?: string;
  url?: string;
};

export type BrowserProfileLifecycleResult = {
  closedTabs: number;
  forgottenProfiles?: number;
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
  /** Move keyboard focus into the page (keyboard route into the native view). */
  focus(tabId: string): Promise<BrowserTabState>;
  /** Show a completed download in the system file manager. */
  revealDownload(downloadId: string): Promise<{ revealed: boolean }>;
  closeTab(tabId: string): Promise<{ closed: boolean }>;
  /** Close the business's browser tabs while retaining profile data. */
  closeBusiness(businessId: string): Promise<BrowserProfileLifecycleResult>;
  /** Close the client's browser tabs while retaining profile data. */
  closeClient(
    businessId: string,
    clientId: string,
  ): Promise<BrowserProfileLifecycleResult>;
  /** Explicitly clear inactive browser profiles and their downloads. */
  forgetBusiness(businessId: string): Promise<{ forgottenProfiles: number }>;
  /** Explicitly clear an inactive client profile and its downloads. */
  forgetClient(
    businessId: string,
    clientId: string,
  ): Promise<{ forgottenProfiles: number }>;
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

/** True when this runtime has the embedded browser (a desktop build, not killed). */
export function isBrowserHostAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.colonyBrowserHost);
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
  focus: (tabId: string) => requireBrowserHost().focus(tabId),
  revealDownload: (downloadId: string) =>
    requireBrowserHost().revealDownload(downloadId),
  closeTab: (tabId: string) => requireBrowserHost().closeTab(tabId),
  closeBusiness: (businessId: string) =>
    requireBrowserHost().closeBusiness(businessId),
  closeClient: (businessId: string, clientId: string) =>
    requireBrowserHost().closeClient(businessId, clientId),
  forgetBusiness: (businessId: string) =>
    requireBrowserHost().forgetBusiness(businessId),
  forgetClient: (businessId: string, clientId: string) =>
    requireBrowserHost().forgetClient(businessId, clientId),
  onEvent: (callback: (event: BrowserHostEvent) => void) =>
    requireBrowserHost().onEvent(callback),
};
