import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentConfigFields } from "./AgentConfigFields.tsx";

test("shared config renderer never asks a credits connection for a customer model or key", () => {
  const selectedRuntime = {
    id: "buzz-agent",
    label: "Colony Agent",
    providerEnvVar: "BUZZ_AGENT_PROVIDER",
    modelEnvVar: "BUZZ_AGENT_MODEL",
    authStatus: { status: "not_applicable" },
  };
  const props = {
    selectedRuntime,
    bakedEnv: [],
    config: {
      provider: "colony-credits",
      model: null,
      preferred_runtime: "buzz-agent",
      env_vars: {},
    },
    isCustomModelEditing: false,
    isCustomProvider: false,
    onConfigChange: () => {},
    onCustomModelEditingChange: () => {},
    onIsCustomProviderChange: () => {},
  };
  const html = renderToStaticMarkup(
    React.createElement(AgentConfigFields, props),
  );
  assert.doesNotMatch(html, /global-agent-model|API key/);
  assert.match(html, /Colony credits \(current\)/);
  const ownKey = renderToStaticMarkup(
    React.createElement(AgentConfigFields, {
      ...props,
      config: { ...props.config, provider: "openrouter" },
    }),
  );
  assert.match(ownKey, /global-agent-model/);
});
