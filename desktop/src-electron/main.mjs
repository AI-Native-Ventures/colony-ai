import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, session } from "electron";

import { loadManifest } from "./host-protocol.mjs";
import { NativeHost } from "./native-host.mjs";
import { RendererHost } from "./renderer-host.mjs";
import { getStage0Target } from "./stage0-platform.mjs";
import { createTrustedIdentityLaunch } from "./identity-launch.mjs";
import {
  isTrustedNavigation,
  publicIpcErrorCode,
  validateExactIpcCall,
} from "./ipc-security.mjs";
import {
  STAGE0_APP_NAME,
  STAGE0_BUILD_FLAVOR,
  STAGE0_INSTRUMENTATION_ENABLED,
  STAGE0_TEST,
  STAGE0_USER_DATA_SUFFIX,
} from "./stage0-flavor.mjs";

const manifest = loadManifest();
const instrumentationEnabled = STAGE0_INSTRUMENTATION_ENABLED;
const instrumentationMutation =
  instrumentationEnabled && STAGE0_TEST.mutationEnv
    ? STAGE0_TEST.mutationNames.includes(process.env[STAGE0_TEST.mutationEnv])
      ? process.env[STAGE0_TEST.mutationEnv]
      : null
    : null;
const CHILD_ENV_ALLOWLIST = Object.freeze([
  "BUZZ_RELAY_URL",
  "BUZZ_DESKTOP_BUILD_RELAY_URL",
]);
const IPC = Object.freeze({
  HEALTH: "colony-stage0:health:get-default-relay-url",
  IDENTITY_SHARED: "colony-stage0:identity:is-shared-identity",
  IDENTITY_GET: "colony-stage0:identity:get-identity",
  LIFECYCLE_SUBSCRIBE: "colony-stage0:lifecycle:subscribe",
  LIFECYCLE_UNSUBSCRIBE: "colony-stage0:lifecycle:unsubscribe",
  BINDING_STATE: "colony-stage0:binding-state",
  LIFECYCLE_EVENT: "colony-stage0:lifecycle:event",
});
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const stage0Target = getStage0Target();
const rendererEntry = path.join(rootDirectory, "feasibility", "index.html");
const testSubframePreload = STAGE0_TEST.subframePreload
  ? path.join(rootDirectory, STAGE0_TEST.subframePreload)
  : null;
const trustedRendererUrl = pathToFileURL(rendererEntry).toString();
const testSubframeFixtureUrl = `${trustedRendererUrl}${STAGE0_TEST.subframeFixtureHash ?? ""}`;

function resolveStage0AppDataDirectory() {
  if (
    process.platform === "darwin" &&
    STAGE0_BUILD_FLAVOR === "normal" &&
    typeof process.env.HOME === "string" &&
    path.isAbsolute(process.env.HOME)
  ) {
    return path.join(process.env.HOME, "Library", "Application Support");
  }
  return app.getPath("appData");
}

const userDataDirectory = path.join(
  resolveStage0AppDataDirectory(),
  manifest.namespace.userDataRelativePath,
  STAGE0_USER_DATA_SUFFIX,
);
const identityLaunch = createTrustedIdentityLaunch({
  manifest,
  flavor: STAGE0_BUILD_FLAVOR,
  electronPlatform: process.platform,
  userDataRoot: userDataDirectory,
});

// This must happen before Electron's ready event. Stage 0 intentionally uses a
// fresh namespace and never probes or opens a legacy Buzz/Colony profile.
app.setName(STAGE0_APP_NAME);
app.setPath("userData", userDataDirectory);

const runtime = {
  window: null,
  transport: null,
  rendererHost: null,
  detachTransportState: null,
  trustedUrl: trustedRendererUrl,
  lifecycleBuffer: [],
  lifecycleSubscribers: new Set(),
  initialLoadComplete: false,
  rebindPromise: null,
  shutdownPromise: null,
  shutdownStarted: false,
  diagnostics: {
    hostStartCount: 0,
    hostPid: null,
    rebindCount: 0,
    rebindGenerations: [],
    lastError: null,
    healthRequestCount: 0,
    healthRequests: [],
    ipcDeniedCount: 0,
    navigationDeniedCount: 0,
    windowOpenDeniedCount: 0,
    permissionDeniedCount: 0,
    lastSecurityDenial: null,
  },
};

// The production identity carrier must reserve its manifest-bound namespace
// before Electron can create the user-data directory. Health-only launches
// retain their existing ready-time startup; only the trusted macOS identity
// path needs this earlier reservation barrier.
const identityStartup = identityLaunch ? startRuntime() : null;

function publishTestState() {
  if (!instrumentationEnabled || !STAGE0_TEST.stateGlobal) return;
  globalThis[STAGE0_TEST.killGlobal] = () => {
    runtime.transport?.child?.kill?.("SIGTERM");
  };
  globalThis[STAGE0_TEST.stateGlobal] = {
    ...runtime.diagnostics,
    userDataPath: app.isReady() ? app.getPath("userData") : userDataDirectory,
    windowCount: BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed(),
    ).length,
    visibleWindowCount: BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed() && window.isVisible(),
    ).length,
    pendingCount: runtime.transport?.pending?.size ?? 0,
    bindingState: runtime.rendererHost?.bindingState() ?? null,
    healthRequests: runtime.diagnostics.healthRequests.map((request) => ({
      ...request,
    })),
  };
}

function noteSecurityDenial(countKey, kind) {
  if (!instrumentationEnabled) return;
  runtime.diagnostics[countKey] += 1;
  runtime.diagnostics.lastSecurityDenial = kind;
  publishTestState();
}

function beginHealthRequestProbe() {
  if (!instrumentationEnabled) return null;
  const probe = {
    generationId: currentGeneration(),
    status: "pending",
    outcome: null,
    terminalCount: 0,
  };
  runtime.diagnostics.healthRequestCount += 1;
  runtime.diagnostics.healthRequests = [
    ...runtime.diagnostics.healthRequests.slice(-7),
    probe,
  ];
  return probe;
}

function settleHealthRequestProbe(probe, status, outcome) {
  if (!probe) return;
  probe.status = status;
  probe.outcome = outcome;
  probe.terminalCount += 1;
  publishTestState();
}

function boundedError(error, fallback = "protocol_error") {
  const code = publicIpcErrorCode(error?.code ?? error?.message, fallback);
  const value = new Error(code);
  value.code = code;
  return value;
}

function trustedFrameSnapshot(frame) {
  return Object.freeze({
    type: "EVENT",
    protocolVersion: frame.protocolVersion,
    profileId: frame.profileId,
    sessionId: frame.sessionId,
    generationId: frame.generationId,
    payload: Object.freeze({ state: frame.payload?.state }),
    event: "host_lifecycle",
    sequence: frame.sequence,
  });
}

function frameKey(frame) {
  return `${frame.generationId}:${frame.sequence}`;
}

function currentGeneration() {
  return runtime.rendererHost?.bindingState().generationId ?? null;
}

function rememberLifecycle(frame) {
  const safeFrame = trustedFrameSnapshot(frame);
  const current = currentGeneration() ?? safeFrame.generationId;
  if (safeFrame.generationId !== current) return;
  if (
    runtime.lifecycleBuffer.some(
      (item) => frameKey(item) === frameKey(safeFrame),
    )
  ) {
    return;
  }
  runtime.lifecycleBuffer = [
    ...runtime.lifecycleBuffer.filter(
      (item) => item.generationId === safeFrame.generationId,
    ),
    safeFrame,
  ].slice(-2);
  const window = runtime.window;
  if (!window || window.isDestroyed()) return;
  for (const webContentsId of runtime.lifecycleSubscribers) {
    if (webContentsId !== window.webContents.id) continue;
    try {
      window.webContents.send(IPC.LIFECYCLE_EVENT, safeFrame);
    } catch {
      runtime.lifecycleSubscribers.delete(webContentsId);
    }
  }
}

function clearLifecycleForRebind() {
  runtime.lifecycleBuffer = [];
  runtime.lifecycleSubscribers.clear();
}

function assertTrustedPayload(event, payload) {
  const window = runtime.window;
  if (!window || window.isDestroyed()) {
    throw boundedError({ code: "invalid_ipc_sender" });
  }
  try {
    validateExactIpcCall({
      event,
      webContents: window.webContents,
      trustedUrl: runtime.trustedUrl,
      payload,
      expectedPayload: {},
    });
  } catch (error) {
    noteSecurityDenial("ipcDeniedCount", error?.code ?? "unknown");
    if (
      instrumentationEnabled &&
      instrumentationMutation !== null &&
      instrumentationMutation === STAGE0_TEST.allowUntrustedIpcMutation
    ) {
      return;
    }
    throw error;
  }
}

function resolveHostPath() {
  const packagedPath = path.join(
    process.resourcesPath,
    stage0Target.helperName,
  );
  if (
    instrumentationEnabled &&
    STAGE0_TEST.hostModeEnv &&
    process.env[STAGE0_TEST.hostModeEnv] === STAGE0_TEST.hostModeMissing
  ) {
    return path.join(
      process.resourcesPath,
      "stage0-test-missing",
      stage0Target.helperName,
    );
  }
  return packagedPath;
}

function createTransport() {
  const inheritedEnv = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (typeof process.env[key] === "string") {
      inheritedEnv[key] = process.env[key];
    }
  }
  // The production identity carrier derives its manifest-bound macOS app-data
  // anchor from HOME. Forward that one platform-owned value only when the
  // trusted identity descriptor is active; v1 health-only launches retain the
  // narrower relay-only environment.
  if (identityLaunch && typeof process.env.HOME === "string") {
    inheritedEnv.HOME = process.env.HOME;
  }
  const spawnEnv = {};
  const fault =
    instrumentationEnabled && STAGE0_TEST.faultEnv
      ? process.env[STAGE0_TEST.faultEnv]
      : null;
  if (instrumentationEnabled && manifest.faultInputs.includes(fault)) {
    spawnEnv[STAGE0_TEST.faultEnv] = fault;
  }
  return new NativeHost({
    executablePath: resolveHostPath(),
    manifest,
    buildId: `electron-stage0-${STAGE0_BUILD_FLAVOR}-${manifest.sourceRevision.slice(0, 12)}`,
    inheritedEnv,
    spawnEnv,
    identityLaunch,
  });
}

function setupIpc() {
  ipcMain.handle(IPC.HEALTH, async (event, payload) => {
    let probe = null;
    try {
      assertTrustedPayload(event, payload);
      probe = beginHealthRequestProbe();
      const responsePromise = runtime.rendererHost.request({
        capability: "health-safe",
        method: "get_default_relay_url",
        payload: {},
      });
      publishTestState();
      const response = await responsePromise;
      if (
        response?.outcome !== "ok" ||
        typeof response.payload?.relayUrl !== "string" ||
        !Number.isSafeInteger(response.generationId)
      ) {
        throw boundedError({ code: "protocol_error" });
      }
      settleHealthRequestProbe(probe, "fulfilled", "ok");
      return Object.freeze({
        relayUrl: response.payload.relayUrl,
        generationId: response.generationId,
      });
    } catch (error) {
      settleHealthRequestProbe(
        probe,
        "rejected",
        publicIpcErrorCode(error?.code, "host_unavailable"),
      );
      runtime.diagnostics.lastError = publicIpcErrorCode(
        error?.code,
        "host_unavailable",
      );
      publishTestState();
      throw boundedError(error, "host_unavailable");
    }
  });

  const handleIdentityCall = async (
    event,
    payload,
    capability,
    method,
  ) => {
    try {
      assertTrustedPayload(event, payload);
      if (!identityLaunch) {
        throw boundedError({ code: "identity_unavailable" });
      }
      const response = await runtime.rendererHost.request({
        capability,
        method,
        payload: {},
      });
      if (response?.outcome !== "ok" || !response.payload) {
        throw boundedError({ code: "protocol_error" });
      }
      if (method === "is_shared_identity") {
        return Object.freeze({ value: response.payload.value });
      }
      return Object.freeze({
        display_name: response.payload.display_name,
        locked: response.payload.locked,
        lost: response.payload.lost,
        pubkey: response.payload.pubkey,
        reset_failed: response.payload.reset_failed,
        storage: response.payload.storage,
      });
    } catch (error) {
      runtime.diagnostics.lastError = publicIpcErrorCode(
        error?.code,
        identityLaunch ? "host_unavailable" : "identity_unavailable",
      );
      publishTestState();
      throw boundedError(
        error,
        identityLaunch ? "host_unavailable" : "identity_unavailable",
      );
    }
  };

  ipcMain.handle(IPC.IDENTITY_SHARED, (event, payload) =>
    handleIdentityCall(
      event,
      payload,
      "identity-mode",
      "is_shared_identity",
    ),
  );

  ipcMain.handle(IPC.IDENTITY_GET, (event, payload) =>
    handleIdentityCall(event, payload, "identity-read", "get_identity"),
  );

  ipcMain.handle(IPC.BINDING_STATE, (event, payload) => {
    try {
      assertTrustedPayload(event, payload);
      return runtime.rendererHost.bindingState();
    } catch (error) {
      throw boundedError(error, "invalid_ipc_sender");
    }
  });

  ipcMain.handle(IPC.LIFECYCLE_SUBSCRIBE, (event, payload) => {
    try {
      assertTrustedPayload(event, payload);
      const id = event.sender.id;
      runtime.lifecycleSubscribers.add(id);
      const generation = currentGeneration();
      return Object.freeze({
        frames: runtime.lifecycleBuffer
          .filter((frame) => frame.generationId === generation)
          .map((frame) => trustedFrameSnapshot(frame)),
      });
    } catch (error) {
      throw boundedError(error, "invalid_ipc_sender");
    }
  });

  ipcMain.handle(IPC.LIFECYCLE_UNSUBSCRIBE, (event, payload) => {
    try {
      assertTrustedPayload(event, payload);
      runtime.lifecycleSubscribers.delete(event.sender.id);
      return Object.freeze({ ok: true });
    } catch (error) {
      throw boundedError(error, "invalid_ipc_sender");
    }
  });
}

function configureWindowSecurity(window) {
  window.webContents.setWindowOpenHandler(() => {
    noteSecurityDenial("windowOpenDeniedCount", "window-open");
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => {
    noteSecurityDenial("navigationDeniedCount", "webview-attach");
    event.preventDefault();
  });
  const handleNavigation = (event, url, isMainFrame = true) => {
    const isTestSubframeFixture =
      instrumentationEnabled &&
      STAGE0_TEST.subframeEnabled &&
      !isMainFrame &&
      url === testSubframeFixtureUrl;
    if (
      !isTestSubframeFixture &&
      !isTrustedNavigation({
        candidateUrl: url,
        trustedUrl: runtime.trustedUrl,
        isMainFrame,
      })
    ) {
      noteSecurityDenial(
        "navigationDeniedCount",
        isMainFrame ? "main-frame" : "subframe",
      );
      event.preventDefault();
      return;
    }
    if (runtime.initialLoadComplete && isMainFrame) {
      beginRendererRebind();
    }
  };
  // Electron 44 emits will-navigate for the main frame without an
  // isMainFrame argument. Treat that event as main-frame navigation; the
  // frame-specific event below is the subframe denial seam.
  window.webContents.on("will-navigate", (event, url) => {
    handleNavigation(event, url, event.isMainFrame !== false);
  });
  window.webContents.on(
    "will-frame-navigate",
    (event, url, _isInPlace, isMainFrame) => {
      handleNavigation(event, url, isMainFrame === true);
    },
  );
  window.webContents.on("will-redirect", (event) => {
    noteSecurityDenial("navigationDeniedCount", "redirect");
    event.preventDefault();
  });
  window.webContents.on("did-start-loading", () => {
    if (
      runtime.initialLoadComplete &&
      window.webContents.isLoadingMainFrame()
    ) {
      beginRendererRebind();
    }
  });
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) {
      runtime.initialLoadComplete = true;
      publishTestState();
    }
  });
  window.webContents.on("destroyed", () => {
    runtime.lifecycleSubscribers.delete(window.webContents.id);
  });
  window.webContents.session.setPermissionRequestHandler(
    (_contents, permission, callback) => {
      noteSecurityDenial("permissionDeniedCount", permission);
      callback(false);
    },
  );
}

function createWindow() {
  if (runtime.window && !runtime.window.isDestroyed()) {
    return runtime.window;
  }
  const window = new BrowserWindow({
    width: 820,
    height: 620,
    minWidth: 620,
    minHeight: 460,
    show: true,
    title: STAGE0_APP_NAME,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The packaged denial fixture is the only opt-in path that enables
      // preload execution in a local subframe. Normal launches keep this
      // secure default disabled.
      nodeIntegrationInSubFrames:
        instrumentationEnabled && STAGE0_TEST.subframeEnabled,
      preload: path.join(rootDirectory, "preload.cjs"),
    },
  });
  runtime.window = window;
  configureWindowSecurity(window);
  window.on("closed", () => {
    if (runtime.window === window) runtime.window = null;
    publishTestState();
  });
  void window.loadFile(rendererEntry).catch((error) => {
    runtime.diagnostics.lastError = publicIpcErrorCode(
      error?.code,
      "invalid_origin",
    );
    publishTestState();
  });
  publishTestState();
  return window;
}

function beginRendererRebind() {
  if (
    runtime.rendererHost?.bindingState().state !== "bound" ||
    runtime.rebindPromise
  ) {
    return runtime.rebindPromise;
  }
  if (
    instrumentationEnabled &&
    instrumentationMutation !== null &&
    instrumentationMutation === STAGE0_TEST.disableRebindMutation
  ) {
    return Promise.resolve(runtime.rendererHost.bindingState());
  }
  clearLifecycleForRebind();
  runtime.diagnostics.rebindCount += 1;
  const current = runtime.rendererHost.bindingState().generationId;
  runtime.rebindPromise = runtime.rendererHost
    .reset()
    .then((state) => {
      runtime.diagnostics.rebindGenerations.push(state.generationId);
      publishTestState();
      return state;
    })
    .catch((error) => {
      runtime.diagnostics.lastError = publicIpcErrorCode(
        error?.code,
        "host_unavailable",
      );
      publishTestState();
      throw error;
    })
    .finally(() => {
      runtime.rebindPromise = null;
    });
  if (instrumentationEnabled && Number.isSafeInteger(current)) {
    publishTestState();
  }
  return runtime.rebindPromise;
}

function initializeRuntime() {
  if (runtime.rendererHost) return;
  runtime.transport = createTransport();
  runtime.rendererHost = new RendererHost({ transport: runtime.transport });
  runtime.detachTransportState = runtime.transport.onState?.(() => {
    publishTestState();
  });
  runtime.rendererHost.onLifecycle((frame) => {
    rememberLifecycle(frame);
    publishTestState();
  });
  runtime.diagnostics.hostStartCount += 1;
}

function registerTestSubframePreload() {
  if (
    !instrumentationEnabled ||
    !STAGE0_TEST.subframeEnabled ||
    !testSubframePreload ||
    typeof session.defaultSession.registerPreloadScript !== "function"
  ) {
    return;
  }
  session.defaultSession.registerPreloadScript({
    filePath: testSubframePreload,
    id: STAGE0_TEST.subframePreloadId,
    type: "frame",
  });
}

async function startRuntime() {
  initializeRuntime();
  try {
    await runtime.rendererHost.start();
    runtime.diagnostics.hostPid = runtime.transport.child?.pid ?? null;
  } catch (error) {
    runtime.diagnostics.lastError = publicIpcErrorCode(
      error?.code,
      "host_unavailable",
    );
  }
  publishTestState();
}

async function disposeRuntime() {
  if (runtime.shutdownPromise) return runtime.shutdownPromise;
  runtime.shutdownPromise = Promise.resolve()
    .then(() => runtime.rendererHost?.dispose())
    .catch((error) => {
      runtime.diagnostics.lastError = publicIpcErrorCode(
        error?.code,
        "host_unavailable",
      );
    })
    .finally(() => {
      runtime.detachTransportState?.();
      runtime.detachTransportState = null;
      runtime.lifecycleSubscribers.clear();
      runtime.window = null;
      publishTestState();
    });
  return runtime.shutdownPromise;
}

app.on("before-quit", (event) => {
  if (runtime.shutdownStarted) return;
  runtime.shutdownStarted = true;
  event.preventDefault();
  void disposeRuntime().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(() => {
  registerTestSubframePreload();
  setupIpc();
  initializeRuntime();
  const ready = identityLaunch ? identityStartup : Promise.resolve();
  void ready.then(() => {
    createWindow();
    if (!identityLaunch) void startRuntime();
  });
});

export { IPC, manifest, runtime, trustedRendererUrl };
