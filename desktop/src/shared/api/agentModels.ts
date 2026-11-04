import type { AgentModelsResponse } from "@/shared/api/types";
import { invokeTauri } from "@/shared/api/tauri";

export type DiscoverAgentModelsInput = {
  acpCommand?: string;
  agentCommand: string;
  agentArgs?: string[];
  provider?: string;
  envVars?: Record<string, string>;
  /** Definition-level env from the harness definition (custom/preset). Merged below user envVars. */
  definitionEnv?: Record<string, string>;
  /** Refreshes a harness-owned model cache after an explicit user request. */
  refresh?: boolean;
};

export async function discoverAgentModels(input: DiscoverAgentModelsInput) {
  return invokeTauri<AgentModelsResponse>("discover_agent_models", { input });
}
