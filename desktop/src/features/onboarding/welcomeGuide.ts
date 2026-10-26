import {
  readScoutBusinessContext,
  type ScoutBusinessContext,
} from "./scoutBusinessContext";
import { buildScoutSystemPrompt } from "./scoutPersona";
import { isStockScoutPrompt } from "./scoutPersona";
import { readWelcomeBusinessContext } from "./welcomeConnection";
import scoutSvg from "./assets/scout.svg?raw";
import { resolveLegacyWelcomeRuntime } from "./ui/agentReadiness";
import { runAgentLifecycle } from "@/features/agents/agentLifecycle";
import { hasAgentStartWatch } from "@/features/agents/agentStartWatch";
import {
  startManagedAgent,
  stopManagedAgent,
} from "@/shared/api/tauriManagedAgents";
import {
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  addChannelMembers,
  createManagedAgent,
  getChannelMembers,
  listManagedAgents,
  updateManagedAgent,
  discoverGitBashPrerequisite,
} from "@/shared/api/tauri";
import { discoverAcpRuntimes } from "@/shared/api/tauriAcpDiscovery";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import { listPersonas, setPersonaActive } from "@/shared/api/tauriPersonas";
import type {
  AcpRuntime,
  AgentPersona,
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export const WELCOME_GUIDE_AGENT_NAME = "Scout";
export const WELCOME_GUIDE_PERSONA_ID = "builtin:fizz";
export const WELCOME_TEAM_ID = "builtin-team:welcome";
export const WELCOME_GUIDE_INTRO_MARKER = "buzz-welcome-intro.v1";
export const WELCOME_SCOUT_AVATAR = `data:image/svg+xml,${encodeURIComponent(scoutSvg)}`;
const LEGACY_WELCOME_GUIDE_AGENT_NAME = "Kit";
export const LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT =
  "You are Kit, Sprout's friendly welcome guide. Help new users understand the community, channels, messages, and agents. Keep introductions concise, practical, and warm.";
export const WELCOME_GUIDE_INTRO_MESSAGE =
  "Hi, I'm Scout. Welcome to Colony.\n\nWhat can I help you build?";

export type WelcomeTeamRole = "lead" | "teammate";

export type WelcomeTeamStarterDefinition = Readonly<{
  name: string;
  personaId: string;
  role: WelcomeTeamRole;
}>;

/** Stable identities used to provision the Rust-seeded Welcome Team. */
export const WELCOME_TEAM_STARTERS = [
  { name: "Scout", personaId: "builtin:fizz", role: "lead" },
] as const satisfies readonly WelcomeTeamStarterDefinition[];

export type WelcomeTeamAgents = [ManagedAgent];

const welcomeTeamPromises = new Map<string, Promise<WelcomeTeamAgents>>();

function normalizeRelayUrl(relayUrl: string | null | undefined) {
  return relayUrl?.trim().replace(/\/+$/, "") ?? null;
}

function isAgentScopedToRelay(agent: ManagedAgent, relayUrl?: string | null) {
  const targetRelayUrl = normalizeRelayUrl(relayUrl);
  if (!targetRelayUrl) {
    return true;
  }
  return normalizeRelayUrl(agent.relayUrl) === targetRelayUrl;
}

function isBuiltInWelcomeGuideAgent(agent: ManagedAgent) {
  return agent.personaId === WELCOME_GUIDE_PERSONA_ID;
}

function isLegacyKitWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    agent.name.trim().toLowerCase() ===
      LEGACY_WELCOME_GUIDE_AGENT_NAME.toLowerCase() &&
    agent.systemPrompt?.trim() === LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT
  );
}

function isWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    isBuiltInWelcomeGuideAgent(agent) || isLegacyKitWelcomeGuideAgent(agent)
  );
}

function pickAgentByStatus(agents: ManagedAgent[]) {
  return (
    agents.find((agent) => agent.status === "running") ??
    agents.find((agent) => agent.status === "deployed") ??
    agents[0] ??
    null
  );
}

export function pickWelcomeGuideAgent(agents: ManagedAgent[]) {
  return pickAgentByStatus(agents.filter(isWelcomeGuideAgent));
}

export function pickWelcomeGuideAgentForRelay(
  agents: ManagedAgent[],
  relayUrl?: string | null,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

/** Reuse a starter by team identity, or its canonical name and runtime when team metadata is absent. */
export function pickWelcomeTeamStarterAgentForRelay(
  agents: ManagedAgent[],
  starter: WelcomeTeamStarterDefinition,
  relayUrl?: string | null,
  agentCommand?: string,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        agent.personaId === starter.personaId &&
        (agent.teamId === WELCOME_TEAM_ID ||
          (agent.teamId === null &&
            agent.name === starter.name &&
            (!agentCommand || agent.agentCommand === agentCommand))) &&
        isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

/** Pubkeys belonging to any managed Welcome Team persona on this relay. */
export async function getWelcomeTeamAgentPubkeys(relayUrl?: string | null) {
  const personaIds = new Set<string>(
    WELCOME_TEAM_STARTERS.map(({ personaId }) => personaId),
  );
  return (await listManagedAgents())
    .filter(
      (agent) =>
        agent.personaId !== null &&
        personaIds.has(agent.personaId) &&
        WELCOME_TEAM_STARTERS.some(
          (starter) =>
            pickWelcomeTeamStarterAgentForRelay([agent], starter, relayUrl) !==
            null,
        ),
    )
    .map((agent) => agent.pubkey);
}

/** Legacy Fizz/Kit lookup retained for existing channel reuse checks. */
export async function getWelcomeGuideAgentPubkeys(relayUrl?: string | null) {
  return (await listManagedAgents())
    .filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    )
    .map((agent) => agent.pubkey);
}

export async function activateWelcomeTeamPersonasSequentially(
  inactivePersonaIds: readonly string[],
  activate: (personaId: string) => Promise<unknown>,
) {
  for (const personaId of inactivePersonaIds) {
    await activate(personaId);
  }
}

async function ensureWelcomeTeamPersonasActive() {
  const personas = await listPersonas();
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );

  for (const starter of WELCOME_TEAM_STARTERS) {
    if (!personasById.has(starter.personaId)) {
      throw new Error(`${starter.name} agent not found.`);
    }
  }

  // Persona activation is a read-modify-write operation over one shared file.
  // Run these sequentially so concurrent writes cannot lose a teammate's
  // activation and leave Welcome provisioning permanently partial.
  await activateWelcomeTeamPersonasSequentially(
    WELCOME_TEAM_STARTERS.filter(
      ({ personaId }) => !personasById.get(personaId)?.isActive,
    ).map(({ personaId }) => personaId),
    (personaId) => setPersonaActive(personaId, true),
  );
}

async function ensureWelcomeTeamMembership(
  channelId: string,
  agents: WelcomeTeamAgents,
) {
  const members = await getChannelMembers(channelId).catch(() => []);
  const memberPubkeys = new Set(
    members.map((member) => normalizePubkey(member.pubkey)),
  );
  const missingAgents = agents.filter(
    (agent) => !memberPubkeys.has(normalizePubkey(agent.pubkey)),
  );
  if (missingAgents.length === 0) {
    return;
  }

  const result = await addChannelMembers({
    channelId,
    pubkeys: missingAgents.map((agent) => agent.pubkey),
    role: "bot",
  });
  const unexpectedError = result.errors.find(
    ({ error }) => !error.toLowerCase().includes("already"),
  );
  if (unexpectedError) {
    throw new Error(unexpectedError.error);
  }
}

export async function buildWelcomeStarterCreateInput(
  starter: WelcomeTeamStarterDefinition,
  persona: AgentPersona,
  runtimes: readonly AcpRuntime[],
  preferredRuntimeId: string | null,
  relayUrl?: string | null,
  business: ScoutBusinessContext | null = null,
): Promise<CreateManagedAgentInput> {
  if (
    preferredRuntimeId &&
    !runtimes.some((runtime) => runtime.id === preferredRuntimeId)
  ) {
    throw new Error("Your selected AI connection is unavailable.");
  }
  const { runtime } = resolveStartRuntimeForDefinition(
    preferredRuntimeId ? { ...persona, runtime: preferredRuntimeId } : persona,
    runtimes,
    preferredRuntimeId,
  );
  return {
    ...(await buildInstanceInputForDefinition(
      starter.role === "lead"
        ? { ...persona, avatarUrl: WELCOME_SCOUT_AVATAR }
        : persona,
      runtime,
    )),
    harnessOverride: true,
    name: starter.name,
    ...(starter.role === "lead" && isStockScoutPrompt(persona.systemPrompt)
      ? { systemPrompt: buildScoutSystemPrompt(business) }
      : {}),
    teamId: WELCOME_TEAM_ID,
    relayUrl: relayUrl ?? undefined,
    spawnAfterCreate: false,
    startOnAppLaunch: false,
    respondTo: "owner-only",
    parallelism: 1,
  };
}

export function welcomeStarterRuntimeUpdate(
  existing: ManagedAgent,
  desired: CreateManagedAgentInput,
  runtimeDefaultArgs: readonly string[] = [],
) {
  if (!desired.agentCommand) return null;

  const desiredArgs = desired.agentArgs ?? [];
  const desiredModel = desired.model ?? null;
  const desiredProvider = desired.provider ?? null;
  const desiredMcpCommand = desired.mcpCommand ?? "";
  // The summary carries resolved launch values. Empty desired args resolve to
  // the runtime defaults, and a persona-linked agent's model and provider
  // resolve from its definition or the global config, never from the record.
  const argsMatch =
    existing.agentArgs.join(",") === desiredArgs.join(",") ||
    (desiredArgs.length === 0 &&
      existing.agentArgs.join(",") === runtimeDefaultArgs.join(","));
  const inheritsModel = existing.personaId != null;
  if (
    existing.agentCommand === desired.agentCommand &&
    argsMatch &&
    (existing.model === desiredModel ||
      (inheritsModel && desiredModel === null)) &&
    (existing.provider === desiredProvider ||
      (inheritsModel && desiredProvider === null)) &&
    existing.mcpCommand === desiredMcpCommand &&
    (!desired.envVars?.COLONY_BUSINESS_PROFILE ||
      existing.envVars.COLONY_BUSINESS_PROFILE ===
        desired.envVars.COLONY_BUSINESS_PROFILE) &&
    (desired.parallelism === undefined ||
      existing.parallelism === desired.parallelism)
  ) {
    return null;
  }

  return {
    pubkey: existing.pubkey,
    agentCommand: desired.agentCommand,
    harnessOverride: true,
    agentArgs: desiredArgs,
    mcpCommand: desiredMcpCommand,
    model: desiredModel,
    provider: desiredProvider,
    ...(desired.envVars?.COLONY_BUSINESS_PROFILE
      ? {
          envVars: {
            ...existing.envVars,
            COLONY_BUSINESS_PROFILE: desired.envVars.COLONY_BUSINESS_PROFILE,
          },
        }
      : {}),
    ...(desired.parallelism === undefined
      ? {}
      : { parallelism: desired.parallelism }),
  };
}

/** Pause before the one more try at starting the starter after a stop. */
const RESTART_RETRY_DELAY_MS = 1_000;

/**
 * Apply changed launch fields to the Welcome starter, and make sure it is
 * running again if it had to be stopped for them.
 *
 * GATE-304 (26 Oct, published 3.0.4): Scout was started for a mention and
 * stopped 5.5 s later with nothing starting it again. This runs on every
 * launch, from a read of the agents taken before slow awaits, and stopped the
 * starter on the strength of that old read. So now:
 *
 * - it runs behind any start or restart of the agent (`runAgentLifecycle`),
 *   so it never stops an agent in the middle of starting;
 * - it reads the starter again just before deciding;
 * - a starter somebody is waiting on (a mention it has not answered) is not
 *   stopped at all: the new settings apply the next time it starts, and the
 *   auto-restart policy takes it from there once it is idle;
 * - when it does stop the starter it starts it again whatever else fails, and
 *   once more if the first start fails.
 */
export async function reconcileWelcomeStarter(
  existing: ManagedAgent,
  desired: CreateManagedAgentInput,
  stop: (
    pubkey: string,
    reason?: string,
  ) => Promise<unknown> = stopManagedAgent,
  update = updateManagedAgent,
  options: {
    start?: typeof startManagedAgent;
    runtimeDefaultArgs?: readonly string[];
    /** The starter as the host knows it now. */
    reload?: (pubkey: string) => Promise<ManagedAgent | undefined>;
    /** Whether somebody is waiting on the agent. */
    isWanted?: (pubkey: string) => boolean;
    retryDelayMs?: number;
  } = {},
): Promise<ManagedAgent> {
  const runtimeUpdate = welcomeStarterRuntimeUpdate(
    existing,
    desired,
    options.runtimeDefaultArgs,
  );
  const stockPromptUpdate =
    existing.personaId === WELCOME_GUIDE_PERSONA_ID &&
    desired.systemPrompt != null &&
    isStockScoutPrompt(desired.systemPrompt) &&
    isStockScoutPrompt(existing.systemPrompt) &&
    existing.systemPrompt !== desired.systemPrompt
      ? { systemPrompt: desired.systemPrompt }
      : {};
  const stockNameUpdate =
    existing.personaId === WELCOME_GUIDE_PERSONA_ID &&
    isStockScoutPrompt(existing.systemPrompt) &&
    existing.name === "Fizz"
      ? { name: "Scout" }
      : {};
  if (
    !runtimeUpdate &&
    !Object.keys(stockPromptUpdate).length &&
    !Object.keys(stockNameUpdate).length
  )
    return existing;
  const start = options.start ?? startManagedAgent;
  const isWanted = options.isWanted ?? hasAgentStartWatch;
  const retryDelayMs = options.retryDelayMs ?? RESTART_RETRY_DELAY_MS;
  return runAgentLifecycle(
    existing.pubkey,
    "welcome starter reconcile",
    async () => {
      let current = existing;
      if (options.reload) {
        try {
          current = (await options.reload(existing.pubkey)) ?? existing;
        } catch (error) {
          console.warn(
            "[welcomeGuide] could not read the starter again, using the earlier read",
            error,
          );
        }
      }
      const wasRunning = current.status === "running";
      // Somebody is waiting on this agent: it keeps running, on its old
      // settings, until it is next started.
      const stopIt = wasRunning && !isWanted(existing.pubkey);
      if (stopIt) {
        await stop(
          existing.pubkey,
          "welcome starter reconcile: its launch settings changed",
        );
      }
      let updated: ManagedAgent | undefined;
      let updateError: unknown;
      try {
        updated = (
          await update({
            pubkey: existing.pubkey,
            ...runtimeUpdate,
            ...stockPromptUpdate,
            ...stockNameUpdate,
          })
        ).agent;
      } catch (error) {
        updateError = error;
      }
      // Kickoff only starts the lead before its first message, so a starter that
      // was running must not be left stopped by this reconcile, even when the
      // update failed.
      let restarted: ManagedAgent | undefined;
      if (stopIt) {
        try {
          restarted = await start(existing.pubkey);
        } catch (firstError) {
          console.warn(
            "[welcomeGuide] the starter did not start again, trying once more",
            firstError,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          restarted = await start(existing.pubkey);
        }
      }
      if (updateError) throw updateError;
      return restarted ?? (updated as ManagedAgent);
    },
  );
}

export function welcomeTeammateHasExpectedAccess(
  teammate: ManagedAgent,
  leadPubkey: string,
  agentAccessOwnerOnly: boolean,
) {
  if (agentAccessOwnerOnly) {
    // Welcome teammates are created owner-only, and the lead remains authorized
    // as a NIP-OA-verified sibling because every Welcome agent shares one owner.
    return (
      teammate.respondTo === "owner-only" &&
      teammate.respondToAllowlist.length === 0
    );
  }
  return (
    teammate.respondTo === "allowlist" &&
    teammate.respondToAllowlist.some(
      (pubkey) => normalizePubkey(pubkey) === normalizePubkey(leadPubkey),
    )
  );
}

/**
 * The access write that moves a Welcome teammate to the state this build
 * expects, or null when it is already there. The remediation target must track
 * {@link welcomeTeammateHasExpectedAccess}: writing `allowlist:[lead]` in an
 * owner-only build would fail the predicate again on the next provisioning
 * pass, so an upgraded install with pre-existing allowlisted teammates would
 * rewrite the same rejected state forever and keep restarting them.
 */
export function welcomeTeammateAccessUpdate(
  teammate: ManagedAgent,
  leadPubkey: string,
  agentAccessOwnerOnly: boolean,
): UpdateManagedAgentInput | null {
  if (
    welcomeTeammateHasExpectedAccess(teammate, leadPubkey, agentAccessOwnerOnly)
  ) {
    return null;
  }
  return agentAccessOwnerOnly
    ? {
        pubkey: teammate.pubkey,
        respondTo: "owner-only",
        respondToAllowlist: [],
      }
    : {
        pubkey: teammate.pubkey,
        respondTo: "allowlist",
        respondToAllowlist: [leadPubkey],
      };
}

/**
 * Ensure the complete built-in Welcome Team is ready for kickoff.
 * The team itself is Rust-seeded; this only activates personas, creates any
 * missing relay-scoped instances. Each caller joins the shared starter to its channel.
 */
async function provisionWelcomeTeam(
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  const existingAgents = await listManagedAgents();
  await ensureWelcomeTeamPersonasActive();
  const [personas, runtimeCatalog, globalConfig] = await Promise.all([
    listPersonas(),
    discoverAcpRuntimes(),
    getGlobalAgentConfig(),
  ]);
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );
  const runtimes = runtimeCatalog.filter(
    (runtime): runtime is AcpRuntime => runtime.availability === "available",
  );

  const runtimePreference =
    globalConfig.preferred_runtime ??
    resolveLegacyWelcomeRuntime(
      runtimeCatalog,
      globalConfig,
      await discoverGitBashPrerequisite(),
    )?.id ??
    null;
  const agents: ManagedAgent[] = [];
  for (const starter of WELCOME_TEAM_STARTERS) {
    const persona = personasById.get(starter.personaId);
    if (!persona) {
      throw new Error(`${starter.name} agent not found.`);
    }
    const desired = await buildWelcomeStarterCreateInput(
      starter,
      persona,
      runtimes,
      runtimePreference,
      relayUrl,
      readScoutBusinessContext(relayUrl),
    );
    const business = readWelcomeBusinessContext(relayUrl);
    if (business)
      desired.envVars = {
        ...desired.envVars,
        COLONY_BUSINESS_PROFILE: JSON.stringify(business),
      };
    const existing = pickWelcomeTeamStarterAgentForRelay(
      existingAgents,
      starter,
      relayUrl,
      desired.agentCommand,
    );
    if (existing) {
      agents.push(
        await reconcileWelcomeStarter(
          existing,
          desired,
          stopManagedAgent,
          updateManagedAgent,
          {
            runtimeDefaultArgs: runtimes.find(
              (runtime) => runtime.command === desired.agentCommand,
            )?.defaultArgs,
            // The agents were read before several slow awaits; the stop
            // decision reads the starter again.
            reload: async (pubkey) =>
              (await listManagedAgents()).find(
                (agent) =>
                  normalizePubkey(agent.pubkey) === normalizePubkey(pubkey),
              ),
          },
        ),
      );
      continue;
    }

    const created = await createManagedAgent(desired);
    agents.push(created.agent);
  }
  const [lead] = agents;
  if (!lead) throw new Error("Scout provisioning did not return the starter.");
  const welcomeAgents: WelcomeTeamAgents = [lead];
  return welcomeAgents;
}

export function ensureWelcomeTeam(
  channelId: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  // Channel seeding and kickoff can overlap, including across Welcome channels.
  // Serialize the starter identity on this community, then join each caller's channel.
  const key = JSON.stringify([
    normalizeRelayUrl(relayUrl),
    WELCOME_TEAM_STARTERS.map((starter) => starter.personaId),
  ]);
  let promise = welcomeTeamPromises.get(key);
  if (!promise) {
    promise = provisionWelcomeTeam(relayUrl).finally(() =>
      welcomeTeamPromises.delete(key),
    );
    welcomeTeamPromises.set(key, promise);
  }
  return promise.then(async (agents) => {
    await ensureWelcomeTeamMembership(channelId, agents);
    return agents;
  });
}
