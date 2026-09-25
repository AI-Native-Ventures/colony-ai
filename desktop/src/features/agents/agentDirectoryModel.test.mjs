import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDirectoryStatus,
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
