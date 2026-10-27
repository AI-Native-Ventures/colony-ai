import assert from "node:assert/strict";
import test from "node:test";
import {
  autoPickColonyAgent,
  bundledAgentIsReady,
  decideAutoPick,
  ownAiIsReady,
  shellToolsNeeded,
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
  let installed = false;
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
    gitBash: async () => {
      return installed
        ? (options.gitBashAfterInstall ?? null)
        : (options.gitBash ?? null);
    },
    installShellTools: async () => {
      calls.push(["installShellTools"]);
      if (options.installError) throw new Error(options.installError);
      installed = options.installOk ?? false;
      return installed;
    },
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

const missingBash = { available: false, path: null };
const freshBash = { available: true, path: "C:\\Colony\\usr\\bin\\bash.exe" };

test("shell tools are needed only on Windows with no bash, no own AI and an otherwise ready bundled agent", () => {
  assert.equal(shellToolsNeeded([bundled()], missingBash), true);
  // Not Windows (null), still checking (undefined), or already available.
  assert.equal(shellToolsNeeded([bundled()], null), false);
  assert.equal(shellToolsNeeded([bundled()], undefined), false);
  assert.equal(shellToolsNeeded([bundled()], freshBash), false);
  // Own AI wins, so nothing is downloaded for someone who has Claude or Codex.
  assert.equal(shellToolsNeeded([claude(), bundled()], missingBash), false);
  assert.equal(shellToolsNeeded([codex(), bundled()], missingBash), false);
  // Shell tools do not help an agent that is itself missing.
  assert.equal(shellToolsNeeded([], missingBash), false);
  assert.equal(shellToolsNeeded([bundled("missing")], missingBash), false);
});

test("a fresh Windows PC gets its shell tools, then the Colony Agent is picked with no screen", async () => {
  const { calls, deps, queryClient } = fixture({
    gitBash: missingBash,
    installOk: true,
    gitBashAfterInstall: freshBash,
  });
  const phases = [];
  const picked = await autoPickColonyAgent(
    {
      queryClient,
      isCurrent: () => true,
      business,
      communityId: "biz-1",
      onShellTools: (active) => phases.push(active),
    },
    deps,
  );
  assert.equal(picked, true);
  assert.deepEqual(names(calls), [
    "access",
    "runtimes",
    "installShellTools",
    "proveBusiness",
    "receipt",
    "cache",
  ]);
  // The screen is told when the download starts and when it is over.
  assert.deepEqual(phases, [true, false]);
});

test("a failed shell tools setup falls back to the screen, which has its own Try again", async () => {
  for (const options of [
    { installOk: false },
    { installError: "network down" },
    // Reported success but bash still is not there (an old host).
    { installOk: true, gitBashAfterInstall: missingBash },
  ]) {
    const { calls, deps, queryClient } = fixture({
      gitBash: missingBash,
      ...options,
    });
    const phases = [];
    assert.equal(
      await autoPickColonyAgent(
        {
          queryClient,
          isCurrent: () => true,
          business,
          communityId: "b",
          onShellTools: (active) => phases.push(active),
        },
        deps,
      ),
      false,
      JSON.stringify(options),
    );
    assert.ok(names(calls).includes("installShellTools"));
    assert.ok(!names(calls).includes("proveBusiness"));
    assert.deepEqual(phases, [true, false], "the screen is never left waiting");
  }
});

test("nothing is downloaded when Claude or Codex works, bash exists, or this is not Windows", async () => {
  for (const options of [
    { runtimes: [claude(), bundled()], gitBash: missingBash },
    { gitBash: freshBash },
    { gitBash: null },
    { access: "not-free", gitBash: missingBash },
  ]) {
    const { calls, deps, queryClient } = fixture(options);
    await autoPickColonyAgent(
      { queryClient, isCurrent: () => true, business, communityId: "b" },
      deps,
    );
    assert.ok(
      !names(calls).includes("installShellTools"),
      JSON.stringify(options),
    );
  }
});

test("a superseded attempt stops after the shell tools and proves nothing", async () => {
  let current = true;
  const { calls, deps, queryClient } = fixture({
    gitBash: missingBash,
    installOk: true,
    gitBashAfterInstall: freshBash,
  });
  const install = deps.installShellTools;
  deps.installShellTools = async () => {
    const ok = await install();
    current = false;
    return ok;
  };
  const phases = [];
  assert.equal(
    await autoPickColonyAgent(
      {
        queryClient,
        isCurrent: () => current,
        business,
        communityId: "b",
        onShellTools: (active) => phases.push(active),
      },
      deps,
    ),
    false,
  );
  assert.ok(!names(calls).includes("proveBusiness"));
  assert.deepEqual(phases, [true, false]);
});
