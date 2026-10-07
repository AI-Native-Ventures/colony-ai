import {
  browserBroker,
  type BrowserActionEntry,
  type BrowserBrokerEvent,
  type BrowserConfirmation,
  type BrowserGrant,
} from "@/shared/api/browserBroker";
import {
  redactText,
  sanitizeUntrusted,
} from "../../../../electron/browser-broker/redaction.mjs";
import { browserApprovalOrigin } from "./browserTaskScope";

export type BrowserControlState = {
  enabled: boolean;
  loading: boolean;
  busy: string | null;
  error: string | null;
  grant: BrowserGrant | null;
  pending: readonly BrowserConfirmation[];
  requestedSites: readonly string[];
  log: readonly BrowserActionEntry[];
};

/** One tab's person controls. No community state or permission is persisted here. */
export function createBrowserControlStore({
  businessId,
  tabId,
  taskId,
  api = browserBroker,
}: {
  businessId: string;
  tabId: string;
  taskId: string | null;
  api?: typeof browserBroker;
}) {
  let state: BrowserControlState = {
    enabled: false,
    loading: true,
    busy: null,
    error: null,
    grant: null,
    pending: [],
    requestedSites: [],
    log: [],
  };
  const listeners = new Set<() => void>();
  let alive = true;
  let lifetime = 0;
  let started = false;
  let revision = 0;
  let operationId = 0;
  let unsubscribe = () => {};
  let refreshPromise: Promise<void> | null = null;
  let refreshAgain = false;
  const siteRequests = new Map<string, readonly string[]>();
  const update = (patch: Partial<BrowserControlState>) => {
    if (!alive) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const belongs = (grant: BrowserGrant) =>
    grant.businessId === businessId &&
    grant.state === "active" &&
    grant.tabIds.includes(tabId);
  const safePending = (items: readonly BrowserConfirmation[]) =>
    items
      .filter(
        (item) => item.tabId === tabId && item.grantId === state.grant?.id,
      )
      .slice(0, 8)
      .map((item) => ({
        ...item,
        summary: sanitizeUntrusted(redactText(item.summary, 300), 300),
      }));
  const mergeLog = (...groups: readonly BrowserActionEntry[][]) => {
    const records = new Map<number, BrowserActionEntry>();
    for (const entry of groups.flat()) {
      if (entry.tabId !== tabId || !Number.isFinite(entry.seq)) continue;
      records.set(entry.seq, {
        seq: entry.seq,
        ts: entry.ts,
        tabId,
        tool: redactText(entry.tool, 80),
        status: redactText(entry.status, 40),
        summary: sanitizeUntrusted(redactText(entry.summary, 300), 300),
      });
    }
    return [...records.values()].sort((a, b) => a.seq - b.seq).slice(-50);
  };

  async function refresh() {
    if (!alive) return;
    if (refreshPromise) {
      refreshAgain = true;
      return refreshPromise;
    }
    const session = lifetime;
    const live = () => alive && session === lifetime;
    const job = (async () => {
      for (let attempt = 0; attempt < 3 && live(); attempt += 1) {
        refreshAgain = false;
        const version = revision;
        try {
          const status = await api.status();
          if (!live()) return;
          if (!status.enabled) {
            update({ enabled: false, loading: false });
            return;
          }
          update({ enabled: true });
          const [grants, pending, log] = await Promise.all([
            api.grants(),
            api.pending(),
            api.log({ tabId, limit: 50 }),
          ]);
          if (!live()) return;
          if (version !== revision) {
            refreshAgain = true;
            continue;
          }
          const grant = grants.find(belongs) ?? null;
          update({ grant, loading: false, error: null });
          update({
            pending: safePending(pending),
            log: mergeLog(log, [...state.log]),
            requestedSites: grant ? (siteRequests.get(grant.id) ?? []) : [],
          });
          if (!refreshAgain) return;
        } catch {
          if (!live()) return;
          update({
            loading: false,
            error: "Browser controls could not be refreshed. Try again.",
          });
          return;
        }
      }
      if (!live()) return;
      update({
        loading: false,
        error: "Browser permissions changed during refresh. Try again.",
      });
    })().finally(() => {
      if (refreshPromise === job) refreshPromise = null;
    });
    refreshPromise = job;
    return job;
  }

  function event(event: BrowserBrokerEvent) {
    if (!alive) return;
    if (event.type === "agent-action") {
      update({ log: mergeLog([...state.log], [event.entry]) });
      return;
    }
    if (event.type === "grant-changed") {
      revision += 1;
      if (event.state !== "active") siteRequests.delete(event.grantId);
      if (event.grantId === state.grant?.id && event.state !== "active")
        update({ grant: null, pending: [], requestedSites: [] });
      void refresh();
      return;
    }
    if (event.type === "confirmation-requested" && event.tabId === tabId) {
      revision += 1;
      if (event.grantId === state.grant?.id)
        update({
          pending: safePending([
            ...state.pending.filter((item) => item.actionId !== event.actionId),
            event,
          ]),
        });
      else void refresh();
    } else if (event.type === "confirmation-resolved") {
      if (event.grantId === state.grant?.id || refreshPromise) {
        revision += 1;
        update({
          pending: state.pending.filter(
            (item) => item.actionId !== event.actionId,
          ),
        });
        if (refreshPromise) refreshAgain = true;
      }
    } else if (
      event.type === "origin-approval-requested" &&
      event.tabId === tabId
    ) {
      const origin = browserApprovalOrigin(event.origin);
      if (!origin) return;
      const sites = siteRequests.get(event.grantId) ?? [];
      if (sites.includes(origin)) return;
      if (siteRequests.size >= 8 && !siteRequests.has(event.grantId)) {
        const oldest = siteRequests.keys().next().value;
        if (oldest) siteRequests.delete(oldest);
      }
      const next = [...sites, origin].slice(-5);
      siteRequests.set(event.grantId, next);
      if (event.grantId === state.grant?.id) update({ requestedSites: next });
    }
  }

  async function run<T>(
    name: string,
    action: () => Promise<T>,
    priority = false,
  ): Promise<T> {
    if (!alive || (state.busy && !priority))
      throw new Error("Browser controls are busy");
    const session = lifetime;
    const id = ++operationId;
    update({ busy: name, error: null, ...(priority ? { pending: [] } : {}) });
    try {
      const result = await action();
      if (alive && session === lifetime && id === operationId) await refresh();
      return result;
    } catch (error) {
      if (alive && session === lifetime && id === operationId) {
        await refresh();
        update({
          error: "The browser control could not be completed. Try again.",
        });
      }
      throw error;
    } finally {
      if (alive && session === lifetime && id === operationId)
        update({ busy: null });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started && alive) return refreshPromise ?? Promise.resolve();
      alive = true;
      started = true;
      const session = ++lifetime;
      siteRequests.clear();
      update({
        grant: null,
        pending: [],
        requestedSites: [],
        log: [],
        busy: null,
        loading: true,
        error: null,
      });
      unsubscribe = api.onEvent((message) => {
        if (alive && session === lifetime) event(message);
      });
      return refresh();
    },
    refresh,
    dispose() {
      alive = false;
      started = false;
      lifetime += 1;
      operationId += 1;
      refreshPromise = null;
      refreshAgain = false;
      unsubscribe();
    },
    approve(agentId: string, origin: string) {
      const site = browserApprovalOrigin(origin);
      if (!taskId || !site || state.grant)
        return Promise.reject(
          new Error("No browser task is ready for approval"),
        );
      return run("approve", () =>
        api.grant({
          agentId,
          taskId,
          businessId,
          tabId,
          allowedOrigins: [site],
          ttlMs: 15 * 60_000,
        }),
      );
    },
    stop() {
      const grant = state.grant;
      return grant
        ? run("stop", () => api.revoke(grant.id), true)
        : Promise.resolve();
    },
    takeOver() {
      const grant = state.grant;
      return grant
        ? run("take-over", () => api.takeOver(grant.id), true)
        : Promise.resolve();
    },
    allowSite(origin: string) {
      const grant = state.grant;
      const site = browserApprovalOrigin(origin);
      if (!grant || !site || !state.requestedSites.includes(site))
        return Promise.reject(new Error("No site is awaiting approval"));
      const session = lifetime;
      return run("site", async () => {
        const result = await api.approveOrigin(grant.id, site);
        if (alive && session === lifetime && state.grant?.id === grant.id) {
          const remaining = state.requestedSites.filter(
            (value) => value !== site,
          );
          siteRequests.set(grant.id, remaining);
          update({ requestedSites: remaining });
        }
        return result;
      });
    },
    confirm(actionId: string, approve: boolean) {
      if (!state.pending.some((item) => item.actionId === actionId))
        return Promise.reject(new Error("No action is awaiting confirmation"));
      return run("confirm", async () => {
        const result = await (approve
          ? api.confirm(actionId)
          : api.reject(actionId));
        if (!result.resolved)
          throw new Error("The action is no longer awaiting confirmation");
        return result;
      });
    },
    chooseUpload() {
      const grant = state.grant;
      return grant
        ? run("upload", () => api.chooseUpload(grant.id))
        : Promise.resolve();
    },
  };
}
