/** Main-owned permission summary. Bearer tokens and broker secrets never cross IPC. */
export type BrowserGrant = {
  id: string;
  agentId: string;
  taskId: string;
  businessId: string;
  clientId: string | null;
  primaryTabId: string;
  tabIds: string[];
  allowedOrigins: string[];
  issuedAt: number;
  expiresAt: number;
  epoch: number;
  state: "active" | "revoked" | "expired" | "taken-over";
};

export type BrowserGrantRequest = {
  agentId: string;
  taskId: string;
  businessId: string;
  clientId?: string | null;
  tabId: string;
  allowedOrigins: string[];
  ttlMs?: number;
};

export type BrowserConfirmation = {
  actionId: string;
  grantId: string;
  tabId: string;
  summary: string;
  category?: string | null;
  expiresAt?: number;
};

export type BrowserActionEntry = {
  seq: number;
  ts: number;
  grantId?: string;
  agentId?: string;
  taskId?: string;
  tabId?: string;
  tool: string;
  status: string;
  summary?: string;
};

export type BrowserBrokerEvent =
  | ({ type: "confirmation-requested" } & BrowserConfirmation)
  | {
      type: "confirmation-resolved";
      actionId: string;
      grantId: string;
      outcome: string;
    }
  | {
      type: "origin-approval-requested";
      grantId: string;
      tabId: string;
      origin: string;
      url: string;
    }
  | { type: "grant-changed"; grantId: string; state: BrowserGrant["state"] }
  | { type: "agent-action"; entry: BrowserActionEntry };

export type BrowserBrokerBridge = {
  request(action: string, payload?: object): Promise<unknown>;
  onEvent(callback: (event: BrowserBrokerEvent) => void): () => void;
};

declare global {
  interface Window {
    colonyBrowserBroker?: BrowserBrokerBridge;
  }
}

function request<T>(action: string, payload?: object): Promise<T> {
  if (!window.colonyBrowserBroker)
    return Promise.reject(
      new Error("The agent browser is unavailable in this runtime"),
    );
  return window.colonyBrowserBroker.request(action, payload) as Promise<T>;
}

/** Trusted person controls. Page content and agents have no access to this bridge. */
export const browserBroker = {
  status: () =>
    window.colonyBrowserBroker
      ? request<{ enabled: boolean }>("agent-status")
      : Promise.resolve({ enabled: false }),
  grant: (payload: BrowserGrantRequest) =>
    request<BrowserGrant>("agent-grant", payload),
  grants: () => request<BrowserGrant[]>("agent-grants"),
  revoke: (grantId: string) =>
    request<{ revoked: boolean }>("agent-revoke", { grantId }),
  takeOver: (grantId: string) =>
    request<{ takenOver: boolean }>("agent-take-over", { grantId }),
  approveOrigin: (grantId: string, url: string) =>
    request<BrowserGrant>("agent-approve-origin", { grantId, url }),
  confirm: (actionId: string) =>
    request<{ resolved: boolean }>("agent-confirm", { actionId }),
  reject: (actionId: string) =>
    request<{ resolved: boolean }>("agent-reject", { actionId }),
  pending: () => request<BrowserConfirmation[]>("agent-pending"),
  log: (
    payload: {
      tabId?: string;
      grantId?: string;
      limit?: number;
      sinceSeq?: number;
    } = {},
  ) => request<BrowserActionEntry[]>("agent-log", payload),
  chooseUpload: (grantId: string) =>
    request<{
      uploadId?: string;
      name?: string;
      size?: number;
      cancelled?: boolean;
    }>("agent-choose-upload", { grantId }),
  onEvent: (callback: (event: BrowserBrokerEvent) => void) =>
    window.colonyBrowserBroker?.onEvent(callback) ?? (() => {}),
};
