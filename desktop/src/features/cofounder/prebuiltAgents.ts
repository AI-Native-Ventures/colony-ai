import type { BuiltInRole } from "@/features/company-hiring/builtInRoles";
import { materializeBuiltInRole } from "@/features/company-hiring/builtInRoles";
import type { AgentPersona, CreatePersonaInput } from "@/shared/api/types";

import type { FunctionId } from "./cofounderRecords";
import prebuiltAgentSource from "./prebuiltAgents.json";

export type PrebuiltAgent = {
  id: string;
  part: FunctionId;
  job: string | null;
  name: string;
  does: string[];
  asks: string[];
  firstMove: string;
  firstMessage: string;
  available: boolean;
  unavailableReason: string;
};

type PrebuiltAgentSource = {
  rules: string[];
  agents: PrebuiltAgent[];
};

const source = prebuiltAgentSource as PrebuiltAgentSource;

/** The approved shared rules that every prebuilt agent receives verbatim. */
export const PREBUILT_AGENT_RULES: readonly string[] = source.rules;

/** All approved head and specialist records. */
export const PREBUILT_AGENTS: readonly PrebuiltAgent[] = source.agents;

/** The five map-hire records, one for each part of the company. */
export const PREBUILT_HEADS: readonly PrebuiltAgent[] = PREBUILT_AGENTS.filter(
  (agent) => agent.job === null,
);

/** Every approved ready-made job specialist. */
export const PREBUILT_SPECIALISTS: readonly PrebuiltAgent[] =
  PREBUILT_AGENTS.filter((agent) => agent.job !== null);

/**
 * A specialist id is the approved durable job id with the `prebuilt-` prefix
 * removed. It is intentionally independent from the job's display copy.
 */
export function prebuiltJobId(agent: PrebuiltAgent): string | null {
  if (!agent.job || !agent.id.startsWith("prebuilt-")) return null;
  const jobId = agent.id.slice("prebuilt-".length);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(jobId) ? jobId : null;
}

/** Finds the one approved specialist for a stable job coordinate. */
export function prebuiltSpecialistForJob(
  functionId: FunctionId,
  jobId: string,
): PrebuiltAgent | null {
  return (
    PREBUILT_SPECIALISTS.find(
      (agent) => agent.part === functionId && prebuiltJobId(agent) === jobId,
    ) ?? null
  );
}

/** Resolves a map display job to its approved specialist without persisting copy. */
export function prebuiltSpecialistForJobName(
  functionId: FunctionId,
  jobName: string,
): PrebuiltAgent | null {
  return (
    PREBUILT_SPECIALISTS.find(
      (agent) => agent.part === functionId && agent.job === jobName,
    ) ?? null
  );
}

export function prebuiltHeadForFunction(
  functionId: FunctionId,
): PrebuiltAgent | null {
  return (
    PREBUILT_HEADS.find(
      (agent) => agent.part === functionId && agent.available,
    ) ?? null
  );
}

/**
 * The text stored in the existing persona system-prompt field. The approved
 * source stays data-only while this adapter makes every stored instruction
 * explicit and inspectable.
 */
export function buildPrebuiltAgentInstructions(agent: PrebuiltAgent): string {
  return [
    `You are ${agent.name}.`,
    `Your part of the company is ${agent.part}.`,
    "",
    "What you do:",
    ...agent.does.map((line) => `- ${line}`),
    "",
    "What you ask the owner for:",
    ...agent.asks.map((line) => `- ${line}`),
    "",
    "Your first move:",
    agent.firstMove,
    "",
    "Company rules:",
    ...PREBUILT_AGENT_RULES.map(
      (rule, index) => `${String(index + 1)}. ${rule}`,
    ),
  ].join("\n");
}

/**
 * Creates the existing built-in-role shape for a selected runtime. The role
 * does not introduce tool permissions: the approved source only describes
 * work and owner approval boundaries.
 */
export function prebuiltBuiltInRole(
  agent: PrebuiltAgent,
  runtimeId: string,
): BuiltInRole {
  return {
    id: agent.id,
    displayName: agent.name,
    description: agent.does[0] ?? agent.firstMove,
    companyRole: {
      job: agent.job ?? agent.name,
      skills: [...agent.does],
      tools: [],
      workerMenu: [runtimeId],
    },
    systemPrompt: buildPrebuiltAgentInstructions(agent),
  };
}

/**
 * Reuses the normal built-in persona materialization path so prebuilt prompts
 * are not stored through a second format.
 */
export function materializePrebuiltAgent(
  agent: PrebuiltAgent,
  runtimeId: string,
  deps: {
    listPersonas: () => Promise<readonly AgentPersona[]>;
    createPersona: (input: CreatePersonaInput) => Promise<AgentPersona>;
    scope?: string;
  },
): Promise<string> {
  return materializeBuiltInRole(prebuiltBuiltInRole(agent, runtimeId), deps);
}
