type PrebuiltHireRunLease = {
  key: string;
  generation: number;
};

let generation = 0;
const activeLeases = new Map<string, number>();

function runKey(communityId: string, hireId: string) {
  return `${communityId}:${hireId.toLowerCase()}`;
}

/** Claims the one continuation allowed for this community and hire. */
export function claimPrebuiltHireRun(
  communityId: string,
  hireId: string,
): PrebuiltHireRunLease | null {
  const key = runKey(communityId, hireId);
  if (activeLeases.has(key)) return null;
  const lease = { key, generation };
  activeLeases.set(key, generation);
  return lease;
}

/** A continuation must still hold this lease before its next side effect. */
export function ownsPrebuiltHireRun(lease: PrebuiltHireRunLease): boolean {
  return (
    lease.generation === generation &&
    activeLeases.get(lease.key) === lease.generation
  );
}

/** Releases the lease only when it still belongs to this continuation. */
export function releasePrebuiltHireRun(lease: PrebuiltHireRunLease): void {
  if (ownsPrebuiltHireRun(lease)) activeLeases.delete(lease.key);
}

/** Community-switch reset, registered in resetCommunityState(). */
export function resetPrebuiltHireRunFence(): void {
  generation += 1;
  activeLeases.clear();
}
