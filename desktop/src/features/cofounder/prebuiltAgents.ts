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

/** All approved head and specialist records. Specialist hiring is not exposed yet. */
export const PREBUILT_AGENTS: readonly PrebuiltAgent[] = source.agents;

/** The five map-hire records, one for each part of the company. */
export const PREBUILT_HEADS: readonly PrebuiltAgent[] = PREBUILT_AGENTS.filter(
  (agent) => agent.job === null,
);

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
      job: agent.job ?? `Head of ${agent.part}`,
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
