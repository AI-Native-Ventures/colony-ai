import { AGENT_START_STALLED_AFTER_MS } from "@/features/agents/agentStartWatch";

import type { AgentPlacement } from "./placementTypes";

export type HomeNoticeKind = "outOfCredit" | "startFailure" | "macOff";

/**
 * Which card, if any, an agent's conversation shows (plan Task 18).
 *
 * - **Out of credit**: the relay says the cloud agent has no AI credit left.
 * - **Start failure**: the relay gave up waking the cloud machine.
 * - **Mac off**: the agent works on a Mac that is not answering, and this
 *   device cannot start it. This is the way back from an agent that went quiet
 *   with its Mac closed (a guard must not hide the only recovery): the agent
 *   works on the Mac, cloud agents are available, nothing shows the agent
 *   online, a message to it has gone unanswered past the stalled window, and
 *   either this device has no copy of the agent or its own start failed.
 */
export function homeNoticeKind(input: {
  placement: AgentPlacement;
  /** The relay says this account may use cloud agents. */
  cloudAvailable: boolean;
  /** The person owns the agent. */
  owned: boolean;
  /** The agent is online (presence), whatever runs it. */
  online: boolean;
  /** This device keeps a copy of the agent. */
  hasLocalRecord: boolean;
  /** This device tried to start the agent and the conversation says it failed
   * or stalled. */
  localStartFailed: boolean;
  /** Unix seconds of the oldest message to the agent nobody answered, or null. */
  oldestUnansweredAt: number | null;
  nowSeconds: number;
}): HomeNoticeKind | null {
  const { placement } = input;
  if (placement.home === "cloud") {
    if (placement.status === "outOfCredit") return "outOfCredit";
    if (placement.status === "failed") return "startFailure";
    return null;
  }
  if (!input.cloudAvailable || !input.owned || input.online) return null;
  if (input.oldestUnansweredAt === null) return null;
  const waitedMs = (input.nowSeconds - input.oldestUnansweredAt) * 1000;
  if (waitedMs < AGENT_START_STALLED_AFTER_MS) return null;
  if (input.hasLocalRecord && !input.localStartFailed) return null;
  return "macOff";
}
