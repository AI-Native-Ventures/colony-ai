import type { Page } from "@playwright/test";
import type {
  BrowserBrokerEvent,
  BrowserConfirmation,
  BrowserGrant,
} from "../../../src/shared/api/browserBroker";

/** What a spec can do with the fake broker, through `window`. */
export type BrowserControlFixture = {
  calls: { action: string; payload: Record<string, unknown> }[];
  grant(): { defaultAccess?: boolean; allowedOrigins: string[] } | null;
  confirmed(): number;
  holdConfirmation(): void;
  failNextStop(): void;
  confirmation(category: string, summary: string): void;
  /** The agent's browser call reached main and it has no browser yet. */
  requestAccess(
    agentId: string,
    taskId: string,
    resume?: boolean,
    communityOrigin?: string,
  ): void;
  /** The active grant ran out. */
  expire(): void;
  site(origin: string): void;
  /** Default access: the broker approves a site the agent asked for itself. */
  approveOnItsOwn(origin: string): void;
  /** The agent did something in a tab (an `agent-action` event). */
  agentAction(
    agentId: string,
    taskId: string,
    tabId: string | undefined,
    tool?: string,
  ): void;
  /** Default access: the agent takes over a tab the person opened. */
  adopt(tabId: string): void;
};

declare global {
  interface Window {
    colonyBrowserControlFixture?: BrowserControlFixture;
  }
}

/** Person-control IPC contract only. Real policy remains in the Electron fixture. */
export async function installBrowserBrokerFake(
  page: Page,
  enabled = true,
  options: { defaultAccess?: boolean } = {},
) {
  await page.addInitScript(
    ({ enabled, defaultAccess }) => {
      let grant: BrowserGrant | null = null;
      const pending = new Map<string, BrowserConfirmation>();
      const listeners = new Set<(event: BrowserBrokerEvent) => void>();
      const calls: { action: string; payload: Record<string, unknown> }[] = [];
      let holdConfirm = false;
      let held: ((result: { resolved: boolean }) => void) | null = null;
      let confirmed = 0;
      let recoveryRequired = false;
      let failStop = false;
      const emit = (event: BrowserBrokerEvent) => {
        for (const listener of listeners) listener(event);
      };
      window.colonyBrowserBroker = {
        onEvent(callback) {
          listeners.add(callback);
          return () => {
            listeners.delete(callback);
          };
        },
        async request(action, input = {}) {
          const payload = input as Record<string, unknown>;
          calls.push({ action, payload: structuredClone(payload) });
          if (action === "agent-status")
            return { enabled, recoveryRequired, defaultAccess };
          if (!enabled) throw new Error("Agent browser is disabled");
          switch (action) {
            case "agent-recover-control":
              recoveryRequired = false;
              emit({
                type: "control-recovery",
                tabId: String(payload.tabId),
                required: false,
              });
              return { recovered: true };
            case "agent-grants":
              return grant ? [structuredClone(grant)] : [];
            case "agent-pending":
              return [...pending.values()];
            case "agent-log":
              return [
                {
                  seq: 1,
                  ts: Date.now(),
                  tabId: grant?.primaryTabId,
                  tool: "browser_type",
                  status: "ok",
                  summary: "Typed text; password=hunter2",
                },
              ];
            case "agent-grant": {
              if (grant || recoveryRequired)
                throw new Error("Control is unavailable");
              grant = {
                ...(structuredClone(payload) as unknown as BrowserGrant),
                id: "fixture-grant",
                clientId: null,
                primaryTabId: String(payload.tabId),
                tabIds: [String(payload.tabId)],
                issuedAt: Date.now(),
                expiresAt: Date.now() + 900_000,
                epoch: 0,
                state: "active",
              };
              emit({
                type: "grant-changed",
                grantId: grant.id,
                state: "active",
              });
              return structuredClone(grant);
            }
            case "agent-revoke":
            case "agent-take-over": {
              const old = grant;
              grant = null;
              pending.clear();
              if (old)
                emit({
                  type: "grant-changed",
                  grantId: old.id,
                  state: action === "agent-revoke" ? "revoked" : "taken-over",
                });
              held?.({ resolved: false });
              held = null;
              if (failStop && old) {
                failStop = false;
                recoveryRequired = true;
                emit({
                  type: "control-recovery",
                  tabId: old.primaryTabId,
                  required: true,
                });
                throw new Error("Native control recovery required");
              }
              return { revoked: true, takenOver: true };
            }
            case "agent-release-tab": {
              // One tab goes back to the person; the task stays active.
              if (!grant) throw new Error("No task");
              grant.tabIds = grant.tabIds.filter(
                (id) => id !== String(payload.tabId),
              );
              emit({
                type: "grant-changed",
                grantId: grant.id,
                state: "active",
                change: "tab-released",
              });
              return { released: true };
            }
            case "agent-approve-origin": {
              if (!grant) throw new Error("No task");
              grant.allowedOrigins.push(String(payload.url));
              return structuredClone(grant);
            }
            case "agent-confirm":
            case "agent-reject": {
              const id = String(payload.actionId);
              if (!pending.has(id)) return { resolved: false };
              if (holdConfirm && action === "agent-confirm")
                return new Promise((resolve) => {
                  held = resolve;
                });
              pending.delete(id);
              if (action === "agent-confirm") confirmed += 1;
              if (grant)
                emit({
                  type: "confirmation-resolved",
                  grantId: grant.id,
                  actionId: id,
                  outcome: action === "agent-confirm" ? "approved" : "rejected",
                });
              return { resolved: true };
            }
            case "agent-choose-upload":
              return { cancelled: true };
            default:
              throw new Error("Unsupported control");
          }
        },
      };
      Object.assign(window, {
        colonyBrowserControlFixture: {
          calls,
          grant: () => grant,
          confirmed: () => confirmed,
          failNextStop: () => {
            failStop = true;
          },
          holdConfirmation: () => {
            holdConfirm = true;
          },
          confirmation(category: string, summary: string) {
            if (!grant) throw new Error("No task");
            const entry = {
              actionId: crypto.randomUUID(),
              grantId: grant.id,
              tabId: grant.primaryTabId,
              summary,
              category,
              expiresAt: Date.now() + 30_000,
            };
            pending.set(entry.actionId, entry);
            emit({ type: "confirmation-requested", ...entry });
          },
          requestAccess(
            agentId: string,
            taskId: string,
            resume = false,
            communityOrigin = "http://localhost:3000",
          ) {
            emit({
              type: "access-requested",
              agentId,
              taskId,
              communityOrigin,
              resume,
            });
          },
          expire() {
            const old = grant;
            grant = null;
            pending.clear();
            if (old)
              emit({
                type: "grant-changed",
                grantId: old.id,
                state: "expired",
              });
          },
          approveOnItsOwn(origin: string) {
            if (!grant) throw new Error("No task");
            grant.allowedOrigins.push(origin);
            emit({
              type: "grant-changed",
              grantId: grant.id,
              state: "active",
              change: "origin-approved",
            });
          },
          agentAction(
            agentId: string,
            taskId: string,
            tabId: string | undefined,
            tool = "browser_snapshot",
          ) {
            emit({
              type: "agent-action",
              entry: {
                seq: calls.length + 1000,
                ts: Date.now(),
                agentId,
                taskId,
                grantId: grant?.id,
                tabId,
                tool,
                status: "ok",
              },
            });
          },
          adopt(tabId: string) {
            if (!grant) throw new Error("No task");
            if (!grant.tabIds.includes(tabId)) grant.tabIds.push(tabId);
            emit({
              type: "grant-changed",
              grantId: grant.id,
              state: "active",
              change: "tab-bound",
            });
          },
          site(origin: string) {
            if (!grant) throw new Error("No task");
            emit({
              type: "origin-approval-requested",
              grantId: grant.id,
              tabId: grant.primaryTabId,
              origin,
              url: origin,
            });
          },
        },
      });
    },
    { enabled, defaultAccess: options.defaultAccess === true },
  );
}
