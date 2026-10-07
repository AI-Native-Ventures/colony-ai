import type { Page } from "@playwright/test";
import type {
  BrowserBrokerEvent,
  BrowserConfirmation,
  BrowserGrant,
} from "../../../src/shared/api/browserBroker";

/** Person-control IPC contract only. Real policy remains in the Electron fixture. */
export async function installBrowserBrokerFake(page: Page, enabled = true) {
  await page.addInitScript(
    ({ enabled }) => {
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
          if (action === "agent-status") return { enabled, recoveryRequired };
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
    { enabled },
  );
}
