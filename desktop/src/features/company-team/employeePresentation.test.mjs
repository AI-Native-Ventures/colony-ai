import assert from "node:assert/strict";
import { test } from "node:test";
import {
  employeeAvatarSource,
  employeeFundingSource,
  employeeModelFields,
  employeeRuntimeStatus,
} from "./employeePresentation.ts";

const member = {
  managedAgent: { status: "running" },
  relayAgent: { status: "unknown" },
};
test("runtime evidence wins over a missing company position and stale active turns", () => {
  for (const [lifecycle, expected] of [
    ["ready", "Ready"],
    ["listening", "Ready"],
    ["failed", "Needs attention"],
    ["stopped", "Offline"],
    ["starting", "Needs attention"],
  ]) {
    assert.equal(
      employeeRuntimeStatus(member, { lifecycle, localSetup: true }, false),
      expected,
    );
  }
  assert.equal(
    employeeRuntimeStatus(
      member,
      { lifecycle: "ready", localSetup: true },
      true,
    ),
    "Working",
  );
  assert.equal(
    employeeRuntimeStatus(
      member,
      { lifecycle: "stopped", localSetup: true },
      true,
    ),
    "Offline",
  );
  assert.equal(
    employeeRuntimeStatus(
      { managedAgent: { status: "stopped" } },
      { lifecycle: "ready", localSetup: true },
      false,
    ),
    "Ready",
  );
  assert.equal(
    employeeRuntimeStatus(member, undefined, false),
    "Needs attention",
  );
  assert.equal(
    employeeRuntimeStatus(
      { relayAgent: { status: "offline" } },
      undefined,
      false,
    ),
    "Offline",
  );
  assert.equal(
    employeeRuntimeStatus(
      member,
      { lifecycle: "ready", localSetup: true },
      true,
      true,
    ),
    "Needs attention",
  );
});
test("employee art uses the profile and instance before the definition, with a Scout fallback", () => {
  const input = {
    name: "Scout",
    personaId: "builtin:fizz",
    scoutArt: "scout.svg",
    definition: "old-definition.svg",
  };
  assert.equal(employeeAvatarSource(input), "scout.svg");
  assert.equal(
    employeeAvatarSource({ ...input, instance: "instance.png" }),
    "instance.png",
  );
  assert.equal(
    employeeAvatarSource({
      ...input,
      instance: "instance.png",
      profile: "profile.png",
    }),
    "profile.png",
  );
  assert.equal(
    employeeAvatarSource({
      name: "Mina",
      scoutArt: "scout.svg",
      definition: "mina.png",
    }),
    "mina.png",
  );
  assert.equal(
    employeeAvatarSource({ name: "Mina", scoutArt: "scout.svg" }),
    null,
  );
});
test("model projection discards personal configuration keys and paths", () => {
  const projected = employeeModelFields({
    normalized: {
      model: { value: "sonnet" },
      thinkingEffort: { value: "high" },
      maxOutputTokens: { value: "16384" },
    },
    advanced: [{ key: "agentPushNotifEnabled", value: "true" }],
    sources: { configFilePath: "private-settings-path" },
  });
  assert.deepEqual(projected, {
    model: "sonnet",
    effort: "high",
    outputLimit: "16384",
    contextLimit: null,
  });
  assert.deepEqual(employeeModelFields(), {
    model: "Not reported",
    effort: "Not reported",
    outputLimit: null,
    contextLimit: null,
  });
});
test("funding reports authentication without inventing a plan or a balance", () => {
  const runtime = {
    id: "claude-code",
    label: "Claude Code",
    availability: "available",
    authStatus: { status: "logged_in" },
  };
  assert.deepEqual(employeeFundingSource({}, runtime, "anthropic"), {
    source: "Claude Code account",
    state: "Connected",
  });
  assert.equal(
    employeeFundingSource(
      {},
      { ...runtime, authStatus: { status: "logged_out" } },
    ).state,
    "Sign-in needed",
  );
  assert.equal(
    employeeFundingSource({}, { ...runtime, authStatus: { status: "unknown" } })
      .state,
    "Connection not reported",
  );
  const keyed = {
    id: "buzz-agent",
    label: "Colony Agent",
    availability: "available",
    authStatus: { status: "not_applicable" },
  };
  assert.equal(
    employeeFundingSource({ provider: "openrouter", envVars: {} }, keyed)
      .source,
    "OpenRouter",
  );
  for (const [status, expected] of [
    ["connected", "Connected"],
    ["limit", "Spending limit reached"],
    ["linked", "Linked; connection test needed"],
    ["unlinked", "Not connected"],
    ["reauth", "Sign-in needed"],
    ["error", "Needs attention"],
  ]) {
    assert.equal(
      employeeFundingSource(
        { provider: "openrouter", envVars: {} },
        keyed,
        null,
        { status },
      ).state,
      expected,
    );
  }
  assert.equal(
    employeeFundingSource(
      {
        provider: "anthropic",
        envVars: { ANTHROPIC_API_KEY: "test-only-placeholder" },
      },
      keyed,
    ).source,
    "Anthropic · Own key",
  );
});
