import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  activateWelcomeTeamPersonasSequentially,
  buildWelcomeStarterCreateInput,
  ensureWelcomeTeam,
  LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT,
  pickWelcomeGuideAgent,
  pickWelcomeGuideAgentForRelay,
  pickWelcomeTeamStarterAgentForRelay,
  welcomeStarterRuntimeUpdate,
  reconcileWelcomeStarter,
  welcomeTeammateAccessUpdate,
  welcomeTeammateHasExpectedAccess,
  WELCOME_GUIDE_AGENT_NAME,
  WELCOME_GUIDE_PERSONA_ID,
  WELCOME_TEAM_ID,
  WELCOME_TEAM_STARTERS,
} from "./welcomeGuide.ts";

const PUB_A = "a".repeat(64);
const PUB_B = "b".repeat(64);
const PUB_C = "c".repeat(64);
const RELAY_A = "ws://localhost:3000";
const RELAY_B = "ws://localhost:3001";

function makeAgent(overrides = {}) {
  return {
    pubkey: PUB_A,
    name: WELCOME_GUIDE_AGENT_NAME,
    personaId: null,
    relayUrl: RELAY_A,
    acpCommand: "buzz-acp",
    agentCommand: "buzz-agent",
    agentCommandOverride: null,
    agentArgs: [],
    mcpCommand: "buzz-dev-mcp",
    turnTimeoutSeconds: 120,
    idleTimeoutSeconds: null,
    maxTurnDurationSeconds: null,
    parallelism: 1,
    systemPrompt: null,
    model: null,
    provider: null,
    envVars: {},
    status: "stopped",
    pid: null,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    lastStartedAt: null,
    lastStoppedAt: null,
    lastExitCode: null,
    lastError: null,
    logPath: "",
    startOnAppLaunch: false,
    backend: { type: "local" },
    backendAgentId: null,
    respondTo: "owner-only",
    respondToAllowlist: [],
    teamId: WELCOME_TEAM_ID,
    ...overrides,
  };
}

test("pickWelcomeGuideAgent reuses a legacy Kit guide", () => {
  const legacyKit = makeAgent({
    name: "Kit",
    pubkey: PUB_A,
    systemPrompt: LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT,
  });

  assert.equal(pickWelcomeGuideAgent([legacyKit]), legacyKit);
});

test("pickWelcomeGuideAgent prefers a running legacy guide over stopped builtin Fizz", () => {
  const stoppedBuiltinFizz = makeAgent({
    pubkey: PUB_A,
    personaId: WELCOME_GUIDE_PERSONA_ID,
    status: "stopped",
  });
  const runningLegacyKit = makeAgent({
    name: "Kit",
    pubkey: PUB_B,
    status: "running",
    systemPrompt: LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT,
  });

  assert.equal(
    pickWelcomeGuideAgent([stoppedBuiltinFizz, runningLegacyKit]),
    runningLegacyKit,
  );
});

test("pickWelcomeGuideAgent ignores non-Kit agents with the legacy prompt", () => {
  const nonKit = makeAgent({
    pubkey: PUB_A,
    name: "Scout",
    systemPrompt: LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT,
  });
  const fizz = makeAgent({
    pubkey: PUB_C,
    personaId: WELCOME_GUIDE_PERSONA_ID,
  });

  assert.equal(pickWelcomeGuideAgent([nonKit, fizz]), fizz);
});

test("pickWelcomeGuideAgentForRelay ignores Fizz agents from other communities", () => {
  const otherCommunityFizz = makeAgent({
    pubkey: PUB_A,
    personaId: WELCOME_GUIDE_PERSONA_ID,
    relayUrl: RELAY_A,
    status: "running",
  });
  const currentCommunityFizz = makeAgent({
    pubkey: PUB_B,
    personaId: WELCOME_GUIDE_PERSONA_ID,
    relayUrl: RELAY_B,
    status: "stopped",
  });

  assert.equal(
    pickWelcomeGuideAgentForRelay(
      [otherCommunityFizz, currentCommunityFizz],
      RELAY_B,
    ),
    currentCommunityFizz,
  );
});

test("pickWelcomeGuideAgentForRelay returns null when Fizz only exists in another community", () => {
  const otherCommunityFizz = makeAgent({
    pubkey: PUB_A,
    personaId: WELCOME_GUIDE_PERSONA_ID,
    relayUrl: RELAY_A,
  });

  assert.equal(
    pickWelcomeGuideAgentForRelay([otherCommunityFizz], RELAY_B),
    null,
  );
});

test("starter persona activation is serialized to protect the shared store", async () => {
  const calls = [];
  let activeWrites = 0;

  await activateWelcomeTeamPersonasSequentially(
    ["builtin:fizz", "builtin:honey", "builtin:bumble"],
    async (personaId) => {
      assert.equal(activeWrites, 0, "activation writes must never overlap");
      activeWrites += 1;
      calls.push(personaId);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeWrites -= 1;
    },
  );

  assert.deepEqual(calls, ["builtin:fizz", "builtin:honey", "builtin:bumble"]);
});

test("all Welcome starters override a bundled persona with the chosen CLI harness", async () => {
  const claude = {
    id: "claude",
    label: "Claude",
    avatarUrl: "https://runtime/claude.png",
    availability: "available",
    command: "claude-code-acp",
    binaryPath: "/bin/claude-code-acp",
    defaultArgs: [],
    mcpCommand: null,
    installHint: "",
    installInstructionsUrl: "",
    canAutoInstall: false,
    underlyingCliPath: "/bin/claude",
  };
  const buzzAgent = {
    ...claude,
    id: "buzz-agent",
    label: "Buzz Agent",
    command: "buzz-agent",
  };

  for (const starter of WELCOME_TEAM_STARTERS) {
    const input = await buildWelcomeStarterCreateInput(
      starter,
      {
        id: starter.personaId,
        displayName: starter.name,
        systemPrompt: `${starter.name} prompt`,
        model: null,
        provider: null,
        runtime: "buzz-agent",
        avatarUrl: null,
        envVars: {},
        isBuiltIn: true,
        isActive: true,
      },
      [buzzAgent, claude],
      "claude",
      RELAY_A,
    );

    assert.notEqual(input.agentCommand, "buzz-agent");
    assert.equal(input.agentCommand, "claude-code-acp");
    assert.equal(input.harnessOverride, true);
    assert.equal(input.personaId, starter.personaId);
    assert.equal(input.teamId, WELCOME_TEAM_ID);
    assert.equal(input.relayUrl, RELAY_A);
    assert.equal(input.spawnAfterCreate, false);
    assert.equal(input.startOnAppLaunch, false);
  }
});

test("existing Welcome starter rematerializes runtime-specific fields atomically", () => {
  const existing = makeAgent({
    pubkey: PUB_A,
    personaId: WELCOME_GUIDE_PERSONA_ID,
    agentCommand: "claude-agent-acp",
    agentCommandOverride: "claude-agent-acp",
    agentArgs: ["--old"],
    mcpCommand: "",
    model: "claude-sonnet",
    provider: "anthropic",
  });

  assert.deepEqual(
    welcomeStarterRuntimeUpdate(existing, {
      name: "Fizz",
      agentCommand: "codex-acp",
      agentArgs: ["--new"],
      mcpCommand: "buzz-dev-mcp",
      model: "gpt-5.6-sol",
      provider: null,
    }),
    {
      pubkey: PUB_A,
      agentCommand: "codex-acp",
      harnessOverride: true,
      agentArgs: ["--new"],
      mcpCommand: "buzz-dev-mcp",
      model: "gpt-5.6-sol",
      provider: null,
    },
  );
});

test("existing Welcome starter clears stale model and provider for Claude", () => {
  const existing = makeAgent({
    personaId: WELCOME_GUIDE_PERSONA_ID,
    agentCommand: "codex-acp",
    agentArgs: [],
    model: "gpt-5.6-sol",
    provider: "openai",
  });

  assert.deepEqual(
    welcomeStarterRuntimeUpdate(existing, {
      name: "Fizz",
      agentCommand: "claude-agent-acp",
      agentArgs: [],
      mcpCommand: "",
    }),
    {
      pubkey: PUB_A,
      agentCommand: "claude-agent-acp",
      harnessOverride: true,
      agentArgs: [],
      mcpCommand: "",
      model: null,
      provider: null,
    },
  );
});

test("existing Welcome starter needs no update when runtime already matches", () => {
  const existing = makeAgent({
    personaId: WELCOME_GUIDE_PERSONA_ID,
    agentCommand: "codex-acp",
    agentArgs: ["--same"],
  });

  assert.equal(
    welcomeStarterRuntimeUpdate(existing, {
      name: "Fizz",
      agentCommand: "codex-acp",
      agentArgs: ["--same"],
      mcpCommand: "buzz-dev-mcp",
      model: null,
      provider: null,
    }),
    null,
  );
});

test("welcome team starter definitions and role identities are stable", () => {
  assert.equal(WELCOME_TEAM_ID, "builtin-team:welcome");
  assert.deepEqual(WELCOME_TEAM_STARTERS, [
    { name: "Scout", personaId: "builtin:fizz", role: "lead" },
  ]);
});

test("starter matching ignores user agents with a Welcome persona", () => {
  const honey = WELCOME_TEAM_STARTERS[0];
  const userHoney = makeAgent({
    name: "My personal helper",
    personaId: honey.personaId,
    teamId: null,
  });

  assert.equal(
    pickWelcomeTeamStarterAgentForRelay([userHoney], honey, RELAY_A),
    null,
  );
});

test("Welcome provisioning is single-flight across channels and reuses a starter with missing team metadata", async () => {
  const previousWindow = globalThis.window;
  const records = [];
  let creations = 0;
  const memberships = [];
  const raw = (value) =>
    Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        field,
      ]),
    );
  globalThis.window = {
    __TAURI_INTERNALS__: {
      async invoke(command, args) {
        switch (command) {
          case "list_managed_agents":
            return records.map((record) => ({ ...record, team_id: null }));
          case "list_personas":
            return [
              {
                id: "builtin:fizz",
                display_name: "Scout",
                is_active: true,
                env_vars: {},
                system_prompt: "Hello",
                runtime: "buzz-agent",
              },
            ];
          case "discover_acp_providers":
            return [
              {
                id: "codex",
                command: "codex",
                availability: "available",
                default_args: [],
                auth_status: { status: "logged_in" },
                definition_env: {},
              },
            ];
          case "get_global_agent_config":
            return {
              preferred_runtime: "codex",
              model: null,
              provider: null,
              env_vars: {},
            };
          case "create_managed_agent": {
            const creationId = ++creations;
            await new Promise((resolve) => setTimeout(resolve, 20));
            const agent = raw(
              makeAgent({
                pubkey: String(creationId).repeat(64),
                personaId: args.input.personaId,
                agentCommand: args.input.agentCommand,
                mcpCommand: "",
                teamId: args.input.teamId,
                relayUrl: args.input.relayUrl,
              }),
            );
            records.push(agent);
            return { agent };
          }
          case "get_channel_members":
            return { members: [] };
          case "add_channel_members":
            memberships.push(args.channelId);
            return { added: args.pubkeys, errors: [] };
          default:
            throw new Error(`Unexpected production command: ${command}`);
        }
      },
    },
  };
  try {
    const [first, second] = await Promise.all([
      ensureWelcomeTeam("welcome-a", RELAY_A),
      ensureWelcomeTeam("welcome-b", `${RELAY_A}/`),
    ]);
    assert.equal(
      creations,
      1,
      "overlapping channels share one provisioning flight",
    );
    const repeated = await ensureWelcomeTeam("welcome-a", RELAY_A);
    assert.equal(
      creations,
      1,
      "both provisioning triggers must use the same Scout",
    );
    assert.equal(first[0].pubkey, second[0].pubkey);
    assert.equal(first[0].pubkey, repeated[0].pubkey);
    const otherCommunity = await ensureWelcomeTeam("welcome-other", RELAY_B);
    assert.equal(creations, 2, "a different community needs its own Scout");
    assert.notEqual(otherCommunity[0].pubkey, first[0].pubkey);
    assert.equal(otherCommunity[0].relayUrl, RELAY_B);
    assert.deepEqual(memberships.sort(), [
      "welcome-a",
      "welcome-a",
      "welcome-b",
      "welcome-other",
    ]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("missing-team starter lookup requires its persona, canonical name, runtime and community", () => {
  const starter = WELCOME_TEAM_STARTERS[0];
  const scout = makeAgent({
    personaId: starter.personaId,
    teamId: null,
    agentCommand: "codex",
  });
  assert.equal(
    pickWelcomeTeamStarterAgentForRelay([scout], starter, RELAY_A, "codex"),
    scout,
  );
  for (const overrides of [
    { personaId: "user:helper" },
    { name: "Personal helper" },
    { agentCommand: "buzz-agent" },
    { relayUrl: RELAY_B },
    { teamId: "user:team" },
  ]) {
    assert.equal(
      pickWelcomeTeamStarterAgentForRelay(
        [{ ...scout, ...overrides }],
        starter,
        RELAY_A,
        "codex",
      ),
      null,
    );
  }
});

test("starter matching uses persona identity rather than display name", () => {
  const honey = WELCOME_TEAM_STARTERS[0];
  const renamedHoney = makeAgent({
    name: "Honey the Helper",
    personaId: honey.personaId,
  });
  const nameOnlyHoney = makeAgent({ name: honey.name, pubkey: PUB_B });

  assert.equal(
    pickWelcomeTeamStarterAgentForRelay(
      [nameOnlyHoney, renamedHoney],
      honey,
      RELAY_A,
    ),
    renamedHoney,
  );
});

test("starter matching is relay scoped and normalizes trailing slashes", () => {
  const pollen = WELCOME_TEAM_STARTERS[0];
  const otherRelay = makeAgent({
    personaId: pollen.personaId,
    relayUrl: RELAY_B,
    status: "running",
  });
  const matchingRelay = makeAgent({
    personaId: pollen.personaId,
    relayUrl: `${RELAY_A}/`,
    pubkey: PUB_B,
  });

  assert.equal(
    pickWelcomeTeamStarterAgentForRelay(
      [otherRelay, matchingRelay],
      pollen,
      RELAY_A,
    ),
    matchingRelay,
  );
});

test("starter matching prefers running, then deployed instances", () => {
  const fizz = WELCOME_TEAM_STARTERS[0];
  const stopped = makeAgent({ personaId: fizz.personaId });
  const deployed = makeAgent({
    personaId: fizz.personaId,
    pubkey: PUB_B,
    status: "deployed",
  });
  const running = makeAgent({
    personaId: fizz.personaId,
    pubkey: PUB_C,
    status: "running",
  });

  assert.equal(
    pickWelcomeTeamStarterAgentForRelay(
      [stopped, deployed, running],
      fizz,
      RELAY_A,
    ),
    running,
  );
  assert.equal(
    pickWelcomeTeamStarterAgentForRelay([stopped, deployed], fizz, RELAY_A),
    deployed,
  );
});

test("owner-only-access policy accepts local Welcome teammates", () => {
  const teammate = makeAgent({
    respondTo: "owner-only",
    respondToAllowlist: [],
  });
  assert.equal(welcomeTeammateHasExpectedAccess(teammate, PUB_B, true), true);
  assert.equal(welcomeTeammateHasExpectedAccess(teammate, PUB_B, false), false);
});

test("access remediation converges for an upgraded owner-only install", () => {
  // Pre-existing installs allowlisted the lead. An owner-only build must move
  // them to owner-only, and the write it makes must satisfy the predicate, so
  // the next provisioning pass makes no further write.
  const allowlisted = makeAgent({
    respondTo: "allowlist",
    respondToAllowlist: [PUB_B],
  });
  const update = welcomeTeammateAccessUpdate(allowlisted, PUB_B, true);
  assert.deepEqual(update, {
    pubkey: PUB_A,
    respondTo: "owner-only",
    respondToAllowlist: [],
  });
  const remediated = makeAgent({
    respondTo: update.respondTo,
    respondToAllowlist: update.respondToAllowlist,
  });
  assert.equal(welcomeTeammateHasExpectedAccess(remediated, PUB_B, true), true);
  assert.equal(welcomeTeammateAccessUpdate(remediated, PUB_B, true), null);
});

test("access remediation allowlists the lead when the build is not owner-only", () => {
  const ownerOnly = makeAgent({
    respondTo: "owner-only",
    respondToAllowlist: [],
  });
  const update = welcomeTeammateAccessUpdate(ownerOnly, PUB_B, false);
  assert.deepEqual(update, {
    pubkey: PUB_A,
    respondTo: "allowlist",
    respondToAllowlist: [PUB_B],
  });
  const remediated = makeAgent({
    respondTo: update.respondTo,
    respondToAllowlist: update.respondToAllowlist,
  });
  assert.equal(
    welcomeTeammateHasExpectedAccess(remediated, PUB_B, false),
    true,
  );
  assert.equal(welcomeTeammateAccessUpdate(remediated, PUB_B, false), null);
});

test("access remediation skips a teammate that already allows the lead", () => {
  const allowlisted = makeAgent({
    respondTo: "allowlist",
    respondToAllowlist: [PUB_B, PUB_C],
  });
  assert.equal(welcomeTeammateAccessUpdate(allowlisted, PUB_B, false), null);
});

test("owner-only-access policy accepts provider Welcome teammates", () => {
  const teammate = makeAgent({
    backend: { type: "provider", id: "remote", config: {} },
    respondTo: "owner-only",
    respondToAllowlist: [],
  });
  assert.equal(welcomeTeammateHasExpectedAccess(teammate, PUB_B, true), true);
  assert.equal(welcomeTeammateHasExpectedAccess(teammate, PUB_B, false), false);
});

test("Welcome refuses a missing selected runtime instead of falling back to bundled", async () => {
  await assert.rejects(
    buildWelcomeStarterCreateInput(
      WELCOME_TEAM_STARTERS[0],
      { runtime: null },
      [{ id: "buzz-agent", availability: "available" }],
      "claude",
    ),
    /selected AI connection is unavailable/,
  );
});

test("changing a running lead stops it before updating so kickoff can launch the chosen runtime", async () => {
  const order = [];
  const existing = makeAgent({ status: "running" });
  const result = await reconcileWelcomeStarter(
    existing,
    {
      agentCommand: "claude-code-acp",
      agentArgs: [],
      mcpCommand: "",
      model: null,
      provider: null,
    },
    async (pubkey) => {
      order.push(["stop", pubkey]);
      return { ...existing, status: "stopped" };
    },
    async (input) => {
      order.push(["update", input.agentCommand]);
      return {
        agent: {
          ...existing,
          status: "stopped",
          agentCommand: input.agentCommand,
        },
      };
    },
  );
  assert.deepEqual(order, [
    ["stop", existing.pubkey],
    ["update", "claude-code-acp"],
  ]);
  assert.equal(result.status, "stopped");
});

test("native Scout seed uses the exact approved SVG in the safe inline catalog format", () => {
  const nativeAvatar = readFileSync(
    new URL(
      "../../../src-tauri/src/managed_agents/scout_avatar.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const svg = readFileSync(
    new URL("./assets/scout.svg", import.meta.url),
    "utf8",
  );
  assert.equal(nativeAvatar, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  assert.ok(nativeAvatar.startsWith("data:image/svg+xml,"));
  assert.ok(Buffer.byteLength(nativeAvatar) <= 8192);
});

test("Scout business context and single-worker preparation use the production update payload", () => {
  const existing = makeAgent({
    agentCommand: "claude",
    envVars: { KEEP: "value" },
    parallelism: 10,
  });
  const facts = JSON.stringify({
    name: "Owner Company",
    website: "https://example.com",
    description: "We deliver groceries.",
  });
  const payload = welcomeStarterRuntimeUpdate(existing, {
    name: "Scout",
    agentCommand: "claude",
    agentArgs: existing.agentArgs,
    mcpCommand: existing.mcpCommand,
    model: existing.model,
    provider: existing.provider,
    parallelism: 1,
    envVars: { COLONY_BUSINESS_PROFILE: facts },
  });
  assert.deepEqual(payload.envVars, {
    KEEP: "value",
    COLONY_BUSINESS_PROFILE: facts,
  });
  assert.equal(payload.parallelism, 1);
  assert.equal(
    welcomeStarterRuntimeUpdate(
      { ...existing, ...payload },
      { ...payload, name: "Scout" },
    ),
    null,
  );
});
