/**
 * Where a start of a local agent learns about mentions the desktop itself did
 * not record.
 *
 * `agentStartWatch` knows the mentions sent in this session. A mention sent
 * before the app was restarted, or one whose send never registered a wake
 * (GATE-303), is known only to the relay. The mention reconciler, which owns
 * the relay read, registers a lookup here while it is mounted; every start of
 * an agent then reaches back to the oldest mention the relay shows the agent
 * never touched, so a newer mention can never move the replay floor past an
 * older unanswered one.
 *
 * A module seam rather than an import: the start path is exercised without a
 * relay, and an unset lookup means "no extra information".
 */

/** Resolves to the unix-second send time of the oldest unanswered mention to
 * the agent, or `undefined` when there is none. Rejects when the relay cannot
 * be read. */
export type StartFloorLookup = (
  agentPubkey: string,
) => Promise<number | undefined>;

/** Longest a start waits for the relay before it goes ahead without it. */
export const START_FLOOR_LOOKUP_TIMEOUT_MS = 2_500;

let lookup: StartFloorLookup | null = null;

export function setStartFloorLookup(next: StartFloorLookup | null) {
  lookup = next;
}

export function getStartFloorLookup(): StartFloorLookup | null {
  return lookup;
}

/**
 * The floor to start with: the lower of `floorUnix` and what the relay shows.
 * A relay that is slow or unreadable costs the start nothing but the extra
 * reach, and says so in the console.
 */
export async function lowerFloorFromRelay(
  agentPubkey: string,
  floorUnix: number,
): Promise<number> {
  const read = lookup;
  if (!read) return floorUnix;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const relayFloor = await Promise.race([
      read(agentPubkey),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("the relay did not answer in time")),
          START_FLOOR_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    return relayFloor === undefined
      ? floorUnix
      : Math.min(floorUnix, relayFloor);
  } catch (error) {
    console.warn(
      "[startFloorLookup] starting without the relay's unanswered mentions",
      error,
    );
    return floorUnix;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
