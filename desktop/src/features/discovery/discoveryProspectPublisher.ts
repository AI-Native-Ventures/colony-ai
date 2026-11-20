import type { ProspectChanges } from "./businessRecordMutations";
import type {
  DiscoveryDeps,
  DiscoveryContext,
} from "./discoveryControllerContract";
import type { ActiveDiscoveryRun } from "./discoveryRunRegistry";
import { isAlreadyExistsError } from "./discoveryRunSupport";

export type PublishOutcome = "created" | "duplicate";

/** Publishes one prospect with bounded transient retry and duplicate handling. */
export async function publishWithRetry(
  run: ActiveDiscoveryRun,
  context: DiscoveryContext,
  changes: ProspectChanges,
  deps: Pick<DiscoveryDeps, "publishProspect" | "sleep">,
  backoffMs: readonly number[],
): Promise<PublishOutcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.publishProspect({ context, changes });
      return "created";
    } catch (error) {
      // The relay refuses a second create for the same record. On the first
      // try that means someone else saved it first; after a retry it means
      // our earlier try did land and only its acknowledgement was lost.
      if (isAlreadyExistsError(error))
        return attempt === 0 ? "duplicate" : "created";
      const delay = backoffMs[attempt];
      if (delay === undefined || run.abort.signal.aborted) throw error;
      await deps.sleep(delay, run.abort.signal);
    }
  }
}
