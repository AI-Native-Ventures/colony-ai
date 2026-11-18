import assert from "node:assert/strict";
import test from "node:test";

import { createManagedAgent } from "./tauri.ts";

function rawAgent() {
  return {
    pubkey: "a".repeat(64),
    name: "Head of Finance",
    persona_id: "persona-finance",
    runtime: null,
    team_id: null,
    relay_url: "ws://relay.example",
    acp_command: "buzz-acp",
    agent_command: "buzz-agent",
    agent_args: [],
    mcp_command: "",
    turn_timeout_seconds: 320,
    idle_timeout_seconds: null,
    max_turn_duration_seconds: null,
    parallelism: 1,
    system_prompt: null,
    avatar_url: null,
    model: "gpt-6",
    provider: "openai",
    persona_out_of_date: false,
    persona_orphaned: false,
    needs_restart: false,
    env_vars: {},
    status: "stopped",
    pid: null,
    created_at: "2026-11-18T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
    last_started_at: null,
    last_stopped_at: null,
    last_exit_code: null,
    last_error: null,
    last_error_code: null,
    log_path: "/tmp/finance-agent.log",
    start_on_app_launch: false,
    backend: { type: "local" },
    backend_agent_id: null,
  };
}

test("createManagedAgent carries the selected effort in its one create request", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        assert.equal(command, "create_managed_agent");
        return {
          agent: rawAgent(),
          private_key_nsec: "nsec1finance",
          profile_sync_error: null,
          spawn_error: null,
        };
      },
    },
  };

  try {
    await createManagedAgent({
      name: "Head of Finance",
      personaId: "persona-finance",
      acpCommand: "buzz-acp",
      agentCommand: "buzz-agent",
      agentArgs: [],
      mcpCommand: "",
      model: "gpt-6",
      provider: "openai",
      effortLevel: "high",
      spawnAfterCreate: false,
      startOnAppLaunch: false,
      backend: { type: "local" },
      respondTo: "owner-only",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.input.effortLevel, "high");
  } finally {
    globalThis.window = previousWindow;
  }
});
