import { randomBytes } from "node:crypto";
import { createBroker } from "./broker-core.mjs";
import { createBrokerServer, defaultSocketPath } from "./broker-server.mjs";
import { createCapabilityStore } from "./capability.mjs";

/**
 * Composition root for the agent browser: capability store, broker, local
 * channel server and the person facing request handler. Nothing here touches
 * Electron; the Electron main process passes in a `driver`.
 *
 * Disabled (the default) it creates nothing, opens no socket and exports no
 * environment, so agent sessions are byte for byte what they were before.
 *
 * `handleRequest` is the ONLY way grants are created, widened, confirmed or
 * revoked. It must be reachable from trusted app windows only; agents and page
 * content have no path to it.
 */

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function text(value, label, max = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new Error(`Invalid ${label}`);
  return value;
}

export async function createBrowserAgentHost({
  enabled = false,
  driver,
  execPath,
  scriptPath,
  runAsNode = true,
  socketPath = defaultSocketPath(),
  secret = randomBytes(24).toString("hex"),
  chooseFile = async () => null,
  brokerOptions = {},
  capabilityOptions = {},
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      env: {},
      stop: async () => {},
      handleRequest: async () => {
        throw new Error("The agent browser is not enabled");
      },
      onEvent: () => () => {},
    };
  }
  if (!driver) throw new Error("A page driver is required");
  const capabilities = createCapabilityStore(capabilityOptions);
  const broker = createBroker({ capabilities, driver, ...brokerOptions });
  driver.attach?.(broker);
  const server = createBrokerServer({
    broker,
    capabilities,
    secret,
    socketPath,
  });
  await server.start();
  const sweeper = setInterval(() => broker.sweep(), 1_000);
  sweeper.unref?.();

  const env = {
    COLONY_BROWSER_MCP_COMMAND: execPath,
    COLONY_BROWSER_MCP_SCRIPT: scriptPath,
    COLONY_BROWSER_MCP_RUN_AS_NODE: runAsNode ? "1" : "0",
    COLONY_BROWSER_BROKER_SOCKET: socketPath,
    COLONY_BROWSER_BROKER_SECRET: secret,
  };

  async function handleRequest(action, payload) {
    if (typeof action !== "string" || !isRecord(payload))
      throw new Error("Invalid agent browser request");
    switch (action) {
      case "agent-grant": {
        const grant = server.issueGrant({
          agentId: text(payload.agentId, "agent id"),
          taskId: text(payload.taskId, "task id"),
          businessId: text(payload.businessId, "business id"),
          clientId: payload.clientId ?? null,
          tabId: text(payload.tabId, "tab id"),
          allowedOrigins: payload.allowedOrigins,
          privateExceptions: payload.privateExceptions,
          ttlMs: payload.ttlMs,
        });
        await driver.setControl?.(grant.primaryTabId, "agent");
        return grant;
      }
      case "agent-revoke":
        return {
          revoked: broker.revoke(
            text(payload.grantId, "grant id"),
            "person revoked",
          ),
        };
      case "agent-take-over":
        return {
          takenOver: broker.takeOver(text(payload.grantId, "grant id")),
        };
      case "agent-approve-origin":
        return broker.approveOrigin(
          text(payload.grantId, "grant id"),
          text(payload.url, "url", 8192),
          {
            allowPrivate: payload.allowPrivate === true,
          },
        );
      case "agent-confirm":
        return {
          resolved: broker.confirm(text(payload.actionId, "action id")),
        };
      case "agent-reject":
        return { resolved: broker.reject(text(payload.actionId, "action id")) };
      case "agent-pending":
        return broker.pendingConfirmations();
      case "agent-log": {
        const limit = Number.isInteger(payload.limit) ? payload.limit : 100;
        return broker.getLog({
          sinceSeq: Number.isInteger(payload.sinceSeq) ? payload.sinceSeq : 0,
          limit,
          grantId:
            typeof payload.grantId === "string" ? payload.grantId : undefined,
          tabId: typeof payload.tabId === "string" ? payload.tabId : undefined,
        });
      }
      case "agent-choose-upload": {
        const grantId = text(payload.grantId, "grant id");
        // Do not open a file dialog for a grant that is not live.
        if (capabilities.getGrant(grantId)?.state !== "active")
          throw new Error("No active grant for this upload");
        const file = await chooseFile();
        if (!file) return { cancelled: true };
        const uploadId = broker.registerUpload(grantId, file);
        return { uploadId, name: file.name, size: file.size };
      }
      default:
        throw new Error("Unsupported agent browser operation");
    }
  }

  async function stop() {
    clearInterval(sweeper);
    capabilities.revokeAll("app closing");
    await server.stop();
  }

  return {
    enabled: true,
    env,
    broker,
    server,
    capabilities,
    handleRequest,
    onEvent: (listener) => broker.onEvent(listener),
    stop,
  };
}
