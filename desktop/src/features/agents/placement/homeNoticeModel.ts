import { AGENT_START_STALLED_AFTER_MS } from "@/features/agents/agentStartWatch";
import type { TimelineMessage } from "@/features/messages/types";

import type { AgentPlacement } from "./placementTypes";

export type HomeNoticeKind =
  | "outOfCredit"
  | "startFailure"
  | "macOff"
  | "freeAiBusy";

const NOTICE_TAG = "colony_notice";
const FREE_AI_BUSY_VALUE = "freeAiBusy";

/**
 * Whether the agent's newest message in the conversation is its tagged
 * "Free AI is busy" notice. The relay's head status does not change for this
 * notice, so the card follows the message: it shows until the agent says
 * something else.
 */
export function freeAiBusyShowing(
  messages: ReadonlyArray<
    Pick<TimelineMessage, "createdAt" | "pubkey" | "tags">
  >,
  agentPubkey: string,
): boolean {
  let newest: (typeof messages)[number] | null = null;
  for (const message of messages) {
    if (message.pubkey?.toLowerCase() !== agentPubkey.toLowerCase()) continue;
    if (!newest || message.createdAt >= newest.createdAt) newest = message;
  }
  return Boolean(
    newest?.tags?.some(
      (tag) => tag[0] === NOTICE_TAG && tag[1] === FREE_AI_BUSY_VALUE,
    ),
  );
}

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
  /** The agent's newest message is its "Free AI is busy" notice. */
  freeAiBusy?: boolean;
}): HomeNoticeKind | null {
  const { placement } = input;
  if (placement.home === "cloud") {
    if (placement.status === "outOfCredit") return "outOfCredit";
    if (placement.status === "failed") return "startFailure";
    if (input.freeAiBusy) return "freeAiBusy";
    return null;
  }
  if (!input.cloudAvailable || !input.owned || input.online) return null;
  if (input.oldestUnansweredAt === null) return null;
  const waitedMs = (input.nowSeconds - input.oldestUnansweredAt) * 1000;
  if (waitedMs < AGENT_START_STALLED_AFTER_MS) return null;
  if (input.hasLocalRecord && !input.localStartFailed) return null;
  return "macOff";
}
