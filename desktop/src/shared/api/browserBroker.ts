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
  /** Made by the app for the owner's own agent; the person can still stop it. */
  defaultAccess?: boolean;
  /** Tabs it took over from the person or from other tasks (a subset of `tabIds`). */
  adoptedTabIds?: string[];
  issuedAt: number;
  expiresAt: number;
  epoch: number;
  state: "active" | "revoked" | "expired" | "taken-over";
};

export type BrowserGrantRequest = {
  agentId: string;
  taskId: string;
  communityOrigin: string;
  businessId: string;
  clientId?: string | null;
  tabId: string;
  /** May be empty only with `defaultAccess`: the agent's own addresses are approved as it asks. */
  allowedOrigins: string[];
  defaultAccess?: boolean;
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
  | {
      /** An agent has no browser yet. `resume` is true after the person stopped it. */
      type: "access-requested";
      agentId: string;
      taskId: string;
      communityOrigin: string;
      resume: boolean;
    }
  | {
      type: "grant-changed";
      grantId: string;
      state: BrowserGrant["state"];
      /** What changed on a grant that is still active, for example "origin-approved". */
      change?: string;
    }
  | { type: "agent-action"; entry: BrowserActionEntry }
  | { type: "control-recovery"; tabId: string; required: boolean };

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
  status: (
    tabId?: string,
  ): Promise<{
    enabled: boolean;
    recoveryRequired?: boolean;
    /** Default access: AI employees share the business's tabs with no approval. */
    defaultAccess?: boolean;
  }> =>
    window.colonyBrowserBroker
      ? request<{
          enabled: boolean;
          recoveryRequired?: boolean;
          defaultAccess?: boolean;
        }>("agent-status", { tabId })
      : Promise.resolve({ enabled: false }),
  recoverControl: (tabId: string) =>
    request<{ recovered: boolean }>("agent-recover-control", { tabId }),
  grant: (payload: BrowserGrantRequest) =>
    request<BrowserGrant>("agent-grant", payload),
  grants: () => request<BrowserGrant[]>("agent-grants"),
  revoke: (grantId: string) =>
    request<{ revoked: boolean }>("agent-revoke", { grantId }),
  takeOver: (grantId: string) =>
    request<{ takenOver: boolean }>("agent-take-over", { grantId }),
  /** Take one tab back; the task keeps the others. */
  releaseTab: (grantId: string, tabId: string) =>
    request<{ released: boolean }>("agent-release-tab", { grantId, tabId }),
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
