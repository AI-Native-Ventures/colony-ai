import assert from "node:assert/strict";
import test from "node:test";
import {
  autoPickColonyAgent,
  bundledAgentIsReady,
  decideAutoPick,
  ownAiIsReady,
} from "./autoPickAi.ts";

const claude = (status = "logged_in", availability = "available") => ({
  id: "claude",
  label: "Claude Code",
  availability,
  command: "claude-agent-acp",
  binaryPath: "/bin/claude",
  providerEnvVar: null,
  authStatus: { status },
});
const codex = (status = "logged_in") => ({
  ...claude(status),
  id: "codex",
  label: "Codex",
});
const bundled = (availability = "available") => ({
  id: "buzz-agent",
  label: "Colony Agent",
  availability,
  command: "buzz-agent",
  binaryPath: "/bin/buzz-agent",
  providerEnvVar: "BUZZ_AGENT_PROVIDER",
  authStatus: { status: "not_applicable" },
});
const emptyConfig = {
  env_vars: { KEEP: "me" },
  provider: null,
  model: "old",
  preferred_runtime: null,
};

test("the decision covers every branch in the brief's order", () => {
  const accesses = ["free", "not-free", "off", "unreachable"];
  for (const access of accesses)
    for (const ownAiReady of [false, true])
      for (const bundledReady of [false, true]) {
        const expected =
          access !== "free"
            ? "connect-screen"
            : ownAiReady
              ? "own-ai"
              : bundledReady
                ? "colony-agent"
                : "connect-screen";
        assert.equal(
          decideAutoPick({ access, ownAiReady, bundledReady }),
          expected,
          `${access} own=${ownAiReady} bundled=${bundledReady}`,
        );
      }
  // The two outcomes that skip the screen or leave it to Claude/Codex.
  assert.equal(
    decideAutoPick({ access: "free", ownAiReady: true, bundledReady: true }),
    "own-ai",
  );
  assert.equal(
    decideAutoPick({ access: "free", ownAiReady: false, bundledReady: true }),
    "colony-agent",
  );
});

test("own AI means Claude Code or Codex installed and signed in, nothing else", () => {
  assert.equal(ownAiIsReady([claude()]), true);
  assert.equal(ownAiIsReady([codex()]), true);
  assert.equal(ownAiIsReady([claude("logged_out")]), false);
  assert.equal(ownAiIsReady([claude("logged_in", "missing")]), false);
  assert.equal(ownAiIsReady([bundled()]), false);
  assert.equal(ownAiIsReady([]), false);
});

test("the bundled agent needs to exist, and Git for Windows on Windows", () => {
  assert.equal(bundledAgentIsReady([bundled()], null), true);
  assert.equal(bundledAgentIsReady([bundled()], { available: true }), true);
  assert.equal(bundledAgentIsReady([bundled()], { available: false }), false);
  assert.equal(bundledAgentIsReady([bundled()], undefined), false);
  assert.equal(bundledAgentIsReady([bundled("missing")], null), false);
  assert.equal(bundledAgentIsReady([claude()], null), false);
});

function fixture(options = {}) {
  const calls = [];
  const queryClient = {
    setQueryData: (key, value) => calls.push(["cache", key, value]),
  };
  const proof = {
    reply: "Hello from Colony",
    model: null,
    startupMs: 1,
    totalMs: 2,
  };
  const deps = {
    access: async () => {
      calls.push(["access"]);
      return options.access ?? "free";
    },
    config: async () => emptyConfig,
    runtimes: async () => {
      calls.push(["runtimes"]);
      return options.runtimes ?? [bundled()];
    },
    gitBash: async () => options.gitBash ?? null,
    prove: async (config, isCurrent) => {
      calls.push(["prove", config, isCurrent()]);
      if (options.proofError) throw new Error(options.proofError);
      return { proof, config: { ...config, saved: true } };
    },
    proveBusiness: async (config, _isCurrent, business) => {
      calls.push(["proveBusiness", config, business]);
      if (options.proofError) throw new Error(options.proofError);
      return { proof, config: { ...config, saved: true } };
    },
    saveReceipt: async (communityId, config, saved) =>
      calls.push(["receipt", communityId, config, saved]),
  };
  return { calls, deps, queryClient };
}
const names = (calls) => calls.map(([name]) => name);
const business = {
  name: "Acme",
  website: "https://acme.example",
  description: "Pies",
};

test("a free account with no AI of its own is picked, proven, saved and remembered", async () => {
  const { calls, deps, queryClient } = fixture();
  const picked = await autoPickColonyAgent(
    { queryClient, isCurrent: () => true, business, communityId: "biz-1" },
    deps,
  );
  assert.equal(picked, true);
  assert.deepEqual(names(calls), [
    "access",
    "runtimes",
    "proveBusiness",
    "receipt",
    "cache",
  ]);
  const candidate = calls.find(([name]) => name === "proveBusiness")[1];
  assert.equal(candidate.preferred_runtime, "buzz-agent");
  assert.equal(candidate.provider, "colony-credits");
  assert.equal(candidate.model, null);
  assert.deepEqual(
    candidate.env_vars,
    { KEEP: "me" },
    "no provider key is added",
  );
  const receipt = calls.find(([name]) => name === "receipt");
  assert.equal(receipt[1], "biz-1");
  assert.equal(receipt[2].saved, true);
});

test("a returning device with no business context proves without a Welcome receipt", async () => {
  const { calls, deps, queryClient } = fixture();
  assert.equal(
    await autoPickColonyAgent({ queryClient, isCurrent: () => true }, deps),
    true,
  );
  assert.deepEqual(names(calls), ["access", "runtimes", "prove", "cache"]);
});

test("Claude Code or Codex signed in is left to today's screen", async () => {
  for (const runtimes of [
    [claude(), bundled()],
    [codex(), bundled()],
  ]) {
    const { calls, deps, queryClient } = fixture({ runtimes });
    assert.equal(
      await autoPickColonyAgent(
        { queryClient, isCurrent: () => true, business, communityId: "b" },
        deps,
      ),
      false,
    );
    assert.ok(
      !names(calls).includes("proveBusiness") &&
        !names(calls).includes("prove"),
    );
  }
});

test("not free, gateway off or unreachable never scans runtimes or proves anything", async () => {
  for (const access of ["not-free", "off", "unreachable"]) {
    const { calls, deps, queryClient } = fixture({ access });
    assert.equal(
      await autoPickColonyAgent(
        { queryClient, isCurrent: () => true, business, communityId: "b" },
        deps,
      ),
      false,
    );
    assert.deepEqual(names(calls), ["access"]);
  }
});

test("a missing bundled agent or Git for Windows falls back to the screen", async () => {
  for (const options of [
    { runtimes: [] },
    { runtimes: [bundled("missing")] },
    { gitBash: { available: false } },
  ]) {
    const { calls, deps, queryClient } = fixture(options);
    assert.equal(
      await autoPickColonyAgent(
        { queryClient, isCurrent: () => true, business, communityId: "b" },
        deps,
      ),
      false,
    );
    assert.ok(!names(calls).includes("proveBusiness"));
  }
});

test("a failed proof falls back quietly and saves no receipt or cache entry", async () => {
  const { calls, deps, queryClient } = fixture({ proofError: "gateway down" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      await autoPickColonyAgent(
        { queryClient, isCurrent: () => true, business, communityId: "b" },
        deps,
      ),
      false,
    );
  } finally {
    console.warn = warn;
  }
  assert.ok(!names(calls).includes("receipt"));
  assert.ok(!names(calls).includes("cache"));
});

test("a superseded attempt neither proves nor saves", async () => {
  let current = true;
  const { calls, deps, queryClient } = fixture();
  const access = deps.access;
  deps.access = async () => {
    const answer = await access();
    current = false;
    return answer;
  };
  assert.equal(
    await autoPickColonyAgent(
      { queryClient, isCurrent: () => current, business, communityId: "b" },
      deps,
    ),
    false,
  );
  assert.deepEqual(names(calls), ["access"]);

  current = true;
  const late = fixture();
  const proveBusiness = late.deps.proveBusiness;
  late.deps.proveBusiness = async (...args) => {
    const result = await proveBusiness(...args);
    current = false;
    return result;
  };
  assert.equal(
    await autoPickColonyAgent(
      {
        queryClient: late.queryClient,
        isCurrent: () => current,
        business,
        communityId: "b",
      },
      late.deps,
    ),
    false,
  );
  assert.ok(!names(late.calls).includes("receipt"));
  assert.ok(!names(late.calls).includes("cache"));
});
