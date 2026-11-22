import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

import {
  __resetModelDiscoveryCacheForTests,
  MODEL_DISCOVERY_REFRESH_AFTER_MS,
  MODEL_DISCOVERY_TIMEOUT_MS,
  modelDiscoveryCacheKey,
  readCachedModelDiscovery,
  requestSharedModelDiscovery,
  saveCachedModelDiscovery,
} from "./personaModelDiscoveryCache.ts";
import { usePersonaModelDiscovery } from "./usePersonaModelDiscovery.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

function response(modelId = "cached-model") {
  return {
    agentName: "Claude Code",
    agentVersion: "1.0.0",
    models: [{ id: modelId, name: modelId, description: null }],
    agentDefaultModel: null,
    selectedModel: modelId,
    supportsSwitching: true,
  };
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const runtime = {
  availability: "available",
  command: "claude",
  defaultArgs: [],
  definitionEnv: {},
  id: "claude",
  label: "Claude Code",
  providerEnvVar: null,
};

function cacheKey() {
  return modelDiscoveryCacheKey({
    agentArgs: runtime.defaultArgs,
    agentCommand: runtime.command,
    provider: "",
    runtimeId: runtime.id,
  });
}

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
});

afterEach(async () => {
  __resetModelDiscoveryCacheForTests();
  dom.window.localStorage.clear();
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

after(() => dom.window.close());

test("cached model options render before a background discovery resolves", async () => {
  saveCachedModelDiscovery(
    cacheKey(),
    response("saved-model"),
    Date.now() - MODEL_DISCOVERY_REFRESH_AFTER_MS - 1,
  );
  const pending = deferred();
  let calls = 0;
  dom.window.__TAURI_INTERNALS__ = {
    invoke: (command) => {
      if (command !== "discover_agent_models") {
        throw new Error(`Unexpected command: ${command}`);
      }
      calls += 1;
      return pending.promise;
    },
  };
  const { renderHook, waitFor } = await import("@testing-library/react");
  const view = renderHook(() =>
    usePersonaModelDiscovery({
      envVars: {},
      isCustomProviderEditing: false,
      modelFieldVisible: true,
      open: true,
      provider: "",
      selectedRuntime: runtime,
    }),
  );

  assert.deepEqual(view.result.current.discoveredModelOptions, [
    { id: "", label: "Default model" },
    { id: "saved-model", label: "saved-model" },
  ]);
  await waitFor(() => assert.equal(calls, 1));
  pending.resolve(response("fresh-model"));
  await waitFor(() =>
    assert.deepEqual(view.result.current.discoveredModelOptions, [
      { id: "", label: "Default model" },
      { id: "fresh-model", label: "fresh-model" },
    ]),
  );
  view.unmount();
});

test("a failed refresh leaves the last usable model list selectable", async () => {
  saveCachedModelDiscovery(
    cacheKey(),
    response("saved-model"),
    Date.now() - MODEL_DISCOVERY_REFRESH_AFTER_MS - 1,
  );
  const refresh = deferred();
  let calls = 0;
  dom.window.__TAURI_INTERNALS__ = {
    invoke: (command) => {
      if (command !== "discover_agent_models") {
        throw new Error(`Unexpected command: ${command}`);
      }
      calls += 1;
      return refresh.promise;
    },
  };
  const { act, renderHook, waitFor } = await import("@testing-library/react");
  const view = renderHook(() =>
    usePersonaModelDiscovery({
      envVars: {},
      isCustomProviderEditing: false,
      modelFieldVisible: true,
      open: true,
      provider: "",
      selectedRuntime: runtime,
    }),
  );

  await waitFor(() => assert.equal(calls, 1));
  await act(async () => {
    refresh.reject(new Error("CLI temporarily unavailable"));
    await Promise.resolve();
  });
  assert.deepEqual(view.result.current.discoveredModelOptions, [
    { id: "", label: "Default model" },
    { id: "saved-model", label: "saved-model" },
  ]);
  assert.equal(view.result.current.modelDiscoveryStatus, null);
  assert.equal(
    readCachedModelDiscovery(cacheKey())?.response.models[0]?.id,
    "saved-model",
  );
  view.unmount();
});

test("one runtime and provider share an in-flight bounded probe", async () => {
  const pending = deferred();
  let calls = 0;
  const request = {
    cacheKey: cacheKey(),
    input: { agentCommand: "claude" },
    requestKey: "first",
    shouldCache: () => true,
  };
  const first = requestSharedModelDiscovery(request, {
    discover: () => {
      calls += 1;
      return pending.promise;
    },
    timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS,
  });
  const second = requestSharedModelDiscovery(request, {
    discover: () => Promise.resolve(response("unexpected")),
  });

  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(calls, 1);
  pending.resolve(response("shared-model"));
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.models[0]?.id, "shared-model");
  assert.equal(secondResponse.models[0]?.id, "shared-model");
  assert.equal(MODEL_DISCOVERY_TIMEOUT_MS, 8_000);
});

test("a hung probe reports its bounded timeout without starting another command", async () => {
  const pending = deferred();
  let calls = 0;
  const timed = requestSharedModelDiscovery(
    {
      cacheKey: cacheKey(),
      input: { agentCommand: "claude" },
      requestKey: "hung",
      shouldCache: () => true,
    },
    {
      discover: () => {
        calls += 1;
        return pending.promise;
      },
      timeoutMs: 20,
    },
  );

  await assert.rejects(timed, /Model discovery timed out/);
  assert.equal(calls, 1);
  pending.resolve(response("late-model"));
  await new Promise((resolve) => queueMicrotask(resolve));
});

test("new credentials wait for the old probe before starting a replacement", async () => {
  const firstProbe = deferred();
  const secondProbe = deferred();
  let calls = 0;
  let markSecondProbeStarted;
  const secondProbeStarted = new Promise((resolve) => {
    markSecondProbeStarted = resolve;
  });
  const discover = () => {
    calls += 1;
    if (calls === 1) return firstProbe.promise;
    markSecondProbeStarted();
    return secondProbe.promise;
  };
  const request = {
    cacheKey: cacheKey(),
    input: { agentCommand: "claude", envVars: { TOKEN: "old" } },
    requestKey: "old-credentials",
    shouldCache: () => true,
  };
  const first = requestSharedModelDiscovery(request, { discover });
  const second = requestSharedModelDiscovery(
    {
      ...request,
      input: { agentCommand: "claude", envVars: { TOKEN: "new" } },
      requestKey: "new-credentials",
    },
    { discover },
  );

  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(calls, 1);
  firstProbe.resolve(response("old-model"));
  await secondProbeStarted;
  assert.equal(calls, 2);
  secondProbe.resolve(response("new-model"));
  const [, replacement] = await Promise.all([first, second]);
  assert.equal(replacement.models[0]?.id, "new-model");
});
