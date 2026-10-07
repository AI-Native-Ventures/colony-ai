import { fileURLToPath } from "node:url";
import { createBrowserAgentHost } from "./browser-agent-host.mjs";
import { createPageDriver } from "./page-driver.mjs";
import { createEgressProxy } from "./egress-proxy.mjs";
import { createUploadStagingStore } from "./upload-staging.mjs";

export const BROWSER_BROKER_EVENT_CHANNEL = "colony:browser-broker-event";
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Compose the main-owned broker. The renderer receives neither driver nor secret. */
export async function createElectronBrowserAgentHost({
  browserHost,
  enabled = false,
  execPath = process.execPath,
  scriptPath = fileURLToPath(new URL("./mcp-server.mjs", import.meta.url)),
  chooseFile = async () => null,
  socketPath,
  uploadStagingRoot,
  uploadStagingOptions = {},
  // Only fixture launchers inject this. Production main never accepts exceptions.
  fixturePrivateExceptions = [],
  proxyFactory = createEgressProxy,
  hostOptions = {},
} = {}) {
  if (!enabled) return createBrowserAgentHost({ enabled: false });
  const staging = createUploadStagingStore({
    ...uploadStagingOptions,
    rootPath: uploadStagingRoot,
  });
  let uploadFailure = false;
  const adapter = browserHost.agentAdapter;
  const profiles = new Map();
  let tail = Promise.resolve();
  let stopped = false;
  const serialize = (task) => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
  const driver = createPageDriver({ adapter });
  const host = await createBrowserAgentHost({
    ...hostOptions,
    enabled: true,
    driver,
    execPath,
    scriptPath,
    socketPath,
    chooseFile: async (grantId) => {
      const check = () => {
        if (stopped || host.capabilities.getGrant(grantId)?.state !== "active")
          throw new Error("No active grant for this upload");
      };
      check();
      if (uploadFailure) throw new Error("Browser upload recovery is required");
      const filePath = await chooseFile();
      if (!filePath) return null;
      check();
      try {
        const file = await staging.stage(grantId, filePath, { check });
        return {
          ...file,
          cleanup: async () => {
            try {
              await staging.cleanup(file.id);
            } catch {
              uploadFailure = true;
              throw new Error("Browser upload recovery is required");
            }
          },
        };
      } catch {
        uploadFailure ||= staging
          .pending()
          .some((entry) => entry.cleanupRequired);
        throw new Error("Browser upload could not be staged");
      }
    },
  });

  async function recoverUploads() {
    try {
      await staging.recover();
      for (const entry of staging.pending()) {
        if (host.capabilities.getGrant(entry.grantId)?.state !== "active")
          await staging.cleanup(entry.id);
      }
      const recovered = uploadFailure;
      uploadFailure = false;
      if (recovered) host.broker.notifyUploadRecovery(adapter.tabIds(), false);
    } catch {
      // The staging store retains ownership records before any payload write.
      uploadFailure = true;
      throw new Error("Browser upload recovery is required");
    }
  }

  function ownedTab(payload, senderId) {
    const tab = adapter.getTab(payload.tabId);
    if (!tab || !adapter.ownedBy(tab.id, senderId))
      throw new Error("Browser tab is unavailable to this app window");
    return tab;
  }

  function ownedGrant(grantId, senderId) {
    const grant = host.capabilities.getGrant(grantId);
    if (!grant || !adapter.ownedBy(grant.primaryTabId, senderId))
      throw new Error("Browser task is unavailable to this app window");
    return grant;
  }

  async function prepare(tab) {
    const session = adapter.session(tab.id);
    let profile = profiles.get(session);
    if (profile?.failure && !profileActive(session)) {
      await cleanup(profile);
      profile = null;
    }
    if (profile) return profile;
    const proxy = proxyFactory({
      getPrivateExceptions: () => fixturePrivateExceptions,
    });
    const port = await proxy.start();
    profile = { proxy, session, tabId: tab.id, failure: null };
    profiles.set(session, profile);
    // Closing existing connections and cache prevents reuse of pre-grant traffic.
    try {
      await session.setProxy({
        mode: "fixed_servers",
        proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
        proxyBypassRules: "<-loopback>",
      });
      await session.closeAllConnections();
      await session.clearCache();
      return profile;
    } catch (error) {
      profile.failure = error;
      throw new Error("Browser network containment could not be installed");
    }
  }

  function profileActive(session) {
    // Check all live tabs sharing the same business profile, including extras.
    return adapter
      .tabIds()
      .some(
        (id) =>
          adapter.session(id) === session &&
          (host.capabilities.grantForTab(id) ||
            host.broker.controlRecoveryRequired(id)),
      );
  }

  async function cleanup(profile) {
    // Keep the restrictive proxy attached until old sockets have been drained.
    await profile.session.closeAllConnections();
    await profile.session.setProxy({ mode: "direct" });
    await profile.proxy.stop();
    profiles.delete(profile.session);
    for (const id of adapter.tabIds()) {
      if (adapter.session(id) === profile.session)
        host.broker.notifyContainmentRecovery(id, false);
    }
  }

  const unsubscribe = host.onEvent((event) => {
    if (
      !(
        event.type === "grant-changed" &&
        ["revoked", "expired", "taken-over"].includes(event.state)
      ) &&
      !(event.type === "control-recovery" && event.required === false)
    )
      return;
    void serialize(async () => {
      try {
        await recoverUploads();
      } catch {
        host.broker.notifyUploadRecovery(adapter.tabIds(), true);
      }
      for (const profile of profiles.values()) {
        if (profileActive(profile.session)) continue;
        try {
          await cleanup(profile);
        } catch (error) {
          // Retain the cleanup record and restrictive proxy for the next retry.
          profile.failure = error;
          for (const id of adapter.tabIds()) {
            if (adapter.session(id) === profile.session)
              host.broker.notifyContainmentRecovery(id, true);
          }
        }
      }
    });
  });
  adapter.setHumanActionHandler((tabId) => {
    const grant = host.capabilities.grantForTab(tabId);
    if (grant) host.broker.takeOver(grant.id);
  });

  async function handleRequest(action, payload, senderId) {
    if (stopped) throw new Error("The agent browser is stopped");
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Invalid agent browser request");
    if (action === "agent-status") {
      if (!payload.tabId) return { enabled: true };
      const tab = ownedTab(payload, senderId);
      return {
        enabled: true,
        recoveryRequired:
          host.broker.controlRecoveryRequired(tab.id) ||
          uploadFailure ||
          Boolean(profiles.get(adapter.session(tab.id))?.failure),
      };
    }
    if (action === "agent-recover-control") {
      const tab = ownedTab(payload, senderId);
      await host.broker.recoverControl(tab.id);
      await serialize(async () => {
        await recoverUploads();
        const profile = profiles.get(adapter.session(tab.id));
        if (!profile?.failure) return;
        if (profileActive(profile.session))
          throw new Error(
            "Stop the other browser tasks before recovering this profile",
          );
        await cleanup(profile);
      });
      return { recovered: true };
    }
    if (action === "agent-grant")
      return serialize(async () => {
        const tab = ownedTab(payload, senderId);
        await recoverUploads();
        if (
          tab.businessId !== payload.businessId ||
          tab.clientId !== (payload.clientId ?? null)
        )
          throw new Error("Browser task does not match the tab profile");
        if (host.capabilities.grantForTab(tab.id))
          throw new Error("This tab already has an active browser task");
        if (payload.privateExceptions?.length)
          throw new Error("Private network browsing is not enabled");
        const profile = await prepare(tab);
        if (profile.failure)
          throw new Error("Browser network containment requires recovery");
        // The tab may have closed or changed scope while setProxy was pending.
        try {
          ownedTab(payload, senderId);
          return await host.handleRequest(action, {
            ...payload,
            privateExceptions: fixturePrivateExceptions,
          });
        } catch (error) {
          if (!profileActive(profile.session)) await cleanup(profile);
          throw error;
        }
      });
    if (["agent-confirm", "agent-reject"].includes(action)) {
      const pending = host.broker
        .pendingConfirmations()
        .find((entry) => entry.actionId === payload.actionId);
      if (!pending) return { resolved: false };
      ownedGrant(pending.grantId, senderId);
    } else if (
      !["agent-pending", "agent-log", "agent-grants"].includes(action)
    ) {
      ownedGrant(payload.grantId, senderId);
      if (payload.allowPrivate)
        throw new Error("Private network browsing is not enabled");
    }
    if (action === "agent-grants")
      return adapter
        .tabIds()
        .filter((id) => adapter.ownedBy(id, senderId))
        .map((id) => host.capabilities.grantForTab(id))
        .filter(
          (grant, index, all) =>
            grant && all.findIndex((other) => other?.id === grant.id) === index,
        );
    if (action === "agent-pending")
      return host.broker
        .pendingConfirmations()
        .filter((entry) => adapter.ownedBy(entry.tabId, senderId));
    if (action === "agent-log") {
      if (payload.grantId) ownedGrant(payload.grantId, senderId);
      return (await host.handleRequest(action, payload)).filter((entry) =>
        adapter.ownedBy(entry.tabId, senderId),
      );
    }
    const result = await host.handleRequest(action, payload);
    if (["agent-revoke", "agent-take-over"].includes(action)) await tail;
    return result;
  }

  return {
    ...host,
    // A cleared native or network fence cannot hide retained file cleanup.
    onEvent: (listener) =>
      host.onEvent((event) => {
        if (event.type === "control-recovery" && !event.required)
          listener({
            ...event,
            required:
              uploadFailure ||
              host.broker.controlRecoveryRequired(event.tabId) ||
              Boolean(profiles.get(adapter.session(event.tabId))?.failure),
          });
        else listener(event);
      }),
    handleRequest,
    async stop() {
      stopped = true;
      unsubscribe();
      await host.stop();
      await tail;
      await staging.cleanupAll();
      for (const profile of profiles.values()) await cleanup(profile);
    },
  };
}

/** Trust the registered app main frame, never a remote browser tab or subframe. */
export function createBrowserBrokerIpcHandler({ windows, trusted, getHost }) {
  return async (event, action, payload = {}) => {
    const entry = windows.get(event.sender.id);
    if (
      entry?.label !== "main" ||
      event.senderFrame !== entry.window.webContents.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error("Untrusted agent browser caller");
    const host = getHost();
    if (action === "agent-status" && (!host.enabled || !payload?.tabId))
      return { enabled: host.enabled };
    return host.handleRequest(action, payload, event.sender.id);
  };
}
