import { useManagedAgentsQuery } from "@/features/agents/hooks";

/**
 * Synchronous gate: does this desktop manage the agent (i.e. hold its
 * seckey locally)? This is the local fast-path owner signal. Callers OR it
 * with the declared NIP-OA owner signal computed from the agent's `kind:0`
 * (`ownsAuthorAgent`), because a remote-owned agent has no local seckey.
 *
 * Returns `boolean | undefined`:
 *   - `undefined` is the loading state (managed-agent list still resolving).
 *     Callers should defer rendering, not show an error.
 *   - `true` / `false` once the list is known.
 *
 * Lowercase compare because pubkeys can arrive from either side in mixed
 * case via Nostr libs.
 */
export function useIsManagedAgent(
  agentPubkey: string | null | undefined,
): boolean | undefined {
  const query = useManagedAgentsQuery();
  if (!agentPubkey) return false;
  if (!query.data) return undefined;
  const lower = agentPubkey.toLowerCase();
  return query.data.some((m) => m.pubkey.toLowerCase() === lower);
}
