import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDirectoryStatus,
  agentDirectoryStatusLabel,
  filterManagedAgents,
  parseAgentDirectoryPageSize,
} from "./agentDirectoryModel.ts";

const runtime = {
  id: "goose",
  label: "Goose",
  command: "goose",
  availability: "available",
  authStatus: { status: "not_applicable" },
};

function agent(overrides = {}) {
  return {
    pubkey: "a".repeat(64),
    name: "Mina",
    runtime: "goose",
    agentCommand: "goose",
    status: "running",
    provider: null,
    model: "claude-sonnet",
    ...overrides,
  };
}

test("directory page size accepts only the designed sizes", () => {
  assert.equal(parseAgentDirectoryPageSize("10"), 10);
  assert.equal(parseAgentDirectoryPageSize("20"), 20);
  assert.equal(parseAgentDirectoryPageSize("30"), 30);
  assert.equal(parseAgentDirectoryPageSize("25"), 30);
  assert.equal(parseAgentDirectoryPageSize(null), 30);
});

test("directory status distinguishes active, idle, stopped, and missing runtime", () => {
  const active = agent();
  const input = {
    activePubkeys: new Set([active.pubkey]),
    archivedPubkeys: new Set(),
    runtimes: [runtime],
  };
  assert.equal(agentDirectoryStatus(active, input), "working");
  assert.equal(
    agentDirectoryStatus(agent({ pubkey: "b".repeat(64) }), input),
    "idle",
  );
  assert.equal(
    agentDirectoryStatus(agent({ status: "stopped" }), input),
    "stopped",
  );
  assert.equal(
    agentDirectoryStatus(
      agent({ runtime: "custom", agentCommand: "custom" }),
      input,
    ),
    "unknown",
  );
});

test("directory classifies the structured harness auth error as needs connection", () => {
  const expired = agent({ status: "stopped", lastErrorCode: -32001 });
  const input = {
    activePubkeys: new Set(),
    archivedPubkeys: new Set(),
    runtimes: [runtime],
  };
  assert.equal(agentDirectoryStatus(expired, input), "needs-connection");
});

test("directory observes the active community runtime, including filters and safe labels", () => {
  const mina = agent();
  const input = {
    activePubkeys: new Set(),
    archivedPubkeys: new Set(),
    runtimes: [],
    relayUrl: "ws://localhost:3000",
    runtimeStatuses: [
      {
        pubkey: mina.pubkey,
        relayUrl: "ws://127.0.0.1:3000",
        lifecycle: "ready",
        localSetup: true,
      },
    ],
  };
  assert.equal(agentDirectoryStatus(mina, input), "idle");
  assert.equal(agentDirectoryStatusLabel("idle"), "Ready");
  assert.equal(agentDirectoryStatusLabel("stopped"), "Offline");
  assert.equal(agentDirectoryStatusLabel("unknown"), "Needs attention");
  assert.equal(
    agentDirectoryStatus(mina, {
      ...input,
      activePubkeys: new Set([mina.pubkey]),
    }),
    "working",
  );
  assert.equal(
    agentDirectoryStatus(mina, { ...input, relayUrl: "wss://other.example" }),
    "needs-connection",
  );
  assert.equal(
    agentDirectoryStatus(mina, { ...input, runtimeQueryFailed: true }),
    "needs-connection",
  );
  assert.deepEqual(
    filterManagedAgents([mina], {
      ...input,
      query: "",
      status: "idle",
      harnessId: "",
    }),
    [mina],
  );
  assert.deepEqual(
    filterManagedAgents([mina], {
      ...input,
      query: "",
      status: "stopped",
      harnessId: "",
    }),
    [],
  );
});

test("directory filters search the real name and catalog harness label", () => {
  const mina = agent();
  const noor = agent({ pubkey: "b".repeat(64), name: "Noor" });
  const input = {
    query: "GOO",
    status: "all",
    harnessId: "",
    activePubkeys: new Set(),
    archivedPubkeys: new Set(),
    runtimes: [runtime],
  };
  assert.deepEqual(filterManagedAgents([mina, noor], input), [mina, noor]);
  assert.deepEqual(
    filterManagedAgents([mina, noor], { ...input, query: "noo" }),
    [noor],
  );
  assert.deepEqual(
    filterManagedAgents([mina, noor], { ...input, harnessId: "missing" }),
    [],
  );
});
