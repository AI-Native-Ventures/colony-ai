import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useGlobalAgentConfig,
  globalAgentConfigQueryKey,
} from "./useGlobalAgentConfig.ts";

function readHook(client) {
  let value;
  function Consumer() {
    value = useGlobalAgentConfig();
    return null;
  }
  renderToString(
    createElement(QueryClientProvider, { client }, createElement(Consumer)),
  );
  client.clear();
  return value;
}

test("placeholder global configuration remains loading for readiness consumers", () => {
  const result = readHook(new QueryClient());
  assert.equal(result.globalConfig.preferred_runtime, null);
  assert.equal(result.isLoading, true);
});

test("a populated native configuration is immediately usable", () => {
  const client = new QueryClient();
  const config = {
    preferred_runtime: "claude",
    model: null,
    provider: null,
    env_vars: {},
  };
  client.setQueryData(globalAgentConfigQueryKey, config);
  const result = readHook(client);
  assert.deepEqual(result.globalConfig, config);
  assert.equal(result.isLoading, false);
  assert.equal(result.isError, false);
});
