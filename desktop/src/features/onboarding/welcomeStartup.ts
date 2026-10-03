import type { ManagedAgent } from "@/shared/api/types";

/** Start concurrently, but let kickoff await only its lead's durable start result. */
export async function startWelcomeAgentsForKickoff(
  agents: readonly ManagedAgent[],
  leadPubkey: string | null,
  start: (agent: ManagedAgent) => Promise<unknown>,
  onFailure: (agent: ManagedAgent, error: unknown) => void,
) {
  const outcomes = new Map<string, PromiseSettledResult<unknown>>();
  const starts = new Map(
    agents.map((agent) => [
      agent.pubkey,
      Promise.resolve()
        .then(() => start(agent))
        .then(
          (value) => {
            const outcome = { status: "fulfilled", value } as const;
            outcomes.set(agent.pubkey, outcome);
            return outcome;
          },
          (reason: unknown) => {
            const outcome = { status: "rejected", reason } as const;
            outcomes.set(agent.pubkey, outcome);
            onFailure(agent, reason);
            return outcome;
          },
        ),
    ]),
  );
  const leadResult = leadPubkey === null ? null : await starts.get(leadPubkey);
  return { starts, outcomes, leadResult };
}
