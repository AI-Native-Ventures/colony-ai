import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";

export type MentionCandidateForRanking = {
  displayName: string | null;
  isAgent: boolean;
  isActiveAgent?: boolean;
  /** An agent with a record on this device, so this device can run it. */
  isManagedAgent?: boolean;
  isMember: boolean;
  kind: "identity" | "persona" | "team";
  personaId?: string | null;
  personaName?: string | null;
  pubkey?: string;
  secondaryLabel?: string | null;
};

export type RankedMentionCandidate<T extends MentionCandidateForRanking> = {
  candidate: T;
  groupRank: number;
  /** 0 for the agent this device runs when other agents share its name. */
  localRank: number;
  label: string;
  order: number;
  score: number;
};

function getMentionCandidateGroupRank(
  candidate: MentionCandidateForRanking,
  activePersonaIds: ReadonlySet<string>,
) {
  if (candidate.isMember) return 0;

  const isRunnablePersona =
    candidate.kind === "team" ||
    candidate.kind === "persona" ||
    (candidate.personaId ? activePersonaIds.has(candidate.personaId) : false);
  if (isRunnablePersona) return 1;

  if (!candidate.isAgent) return 2;

  return 3;
}

function sameNameKey(candidate: MentionCandidateForRanking) {
  return candidate.kind === "identity" && candidate.isAgent
    ? (candidate.displayName?.trim().toLowerCase() ?? "")
    : "";
}

/**
 * How many agents share each name, and the best group any of them ranks in.
 * One account can hold many agents under one name (every reinstall makes a new
 * agent key), and only one of them is the agent this device runs.
 */
function sameNameAgents(
  candidates: readonly MentionCandidateForRanking[],
  activePersonaIds: ReadonlySet<string>,
) {
  const stats = new Map<string, { count: number; bestGroupRank: number }>();
  for (const candidate of candidates) {
    const key = sameNameKey(candidate);
    if (!key) continue;
    const groupRank = getMentionCandidateGroupRank(candidate, activePersonaIds);
    const stat = stats.get(key);
    stats.set(key, {
      count: (stat?.count ?? 0) + 1,
      bestGroupRank: Math.min(stat?.bestGroupRank ?? groupRank, groupRank),
    });
  }
  return stats;
}

function scoreMentionCandidateLabel(
  label: string,
  lowerQuery: string,
): number | null {
  const lower = label.toLowerCase();
  if (lower === lowerQuery) return 0;
  if (lower.startsWith(lowerQuery)) return 1;

  const words = lower.split(/[\s\-_]+/).filter(Boolean);
  if (words.some((word) => word === lowerQuery)) return 2;
  if (words.some((word) => word.startsWith(lowerQuery))) return 3;

  return null;
}

export function pickDefaultAgentCandidate<T extends MentionCandidateForRanking>(
  candidates: readonly T[],
  activePersonaIds: ReadonlySet<string> = new Set(),
  recentMentionPubkeys: readonly string[] = [],
): T | null {
  const recentMentionRankByPubkey = new Map(
    recentMentionPubkeys.map((pubkey, index) => [
      normalizePubkey(pubkey),
      index,
    ]),
  );
  return (
    candidates
      .filter((candidate) => candidate.isAgent && Boolean(candidate.pubkey))
      .sort((left, right) => {
        const leftRecentRank = left.pubkey
          ? recentMentionRankByPubkey.get(normalizePubkey(left.pubkey))
          : undefined;
        const rightRecentRank = right.pubkey
          ? recentMentionRankByPubkey.get(normalizePubkey(right.pubkey))
          : undefined;
        const recentDiff =
          (leftRecentRank ?? recentMentionPubkeys.length) -
          (rightRecentRank ?? recentMentionPubkeys.length);
        if (recentDiff !== 0) return recentDiff;
        const activeDiff =
          Number(right.isActiveAgent === true) -
          Number(left.isActiveAgent === true);
        if (activeDiff !== 0) return activeDiff;
        const memberDiff = Number(right.isMember) - Number(left.isMember);
        if (memberDiff !== 0) return memberDiff;
        const runnableDiff =
          Number(
            Boolean(right.personaId) &&
              activePersonaIds.has(right.personaId ?? ""),
          ) -
          Number(
            Boolean(left.personaId) &&
              activePersonaIds.has(left.personaId ?? ""),
          );
        if (runnableDiff !== 0) return runnableDiff;
        const labelDiff = (left.displayName ?? "").localeCompare(
          right.displayName ?? "",
          undefined,
          { sensitivity: "base" },
        );
        if (labelDiff !== 0) return labelDiff;
        return (left.pubkey ?? "").localeCompare(right.pubkey ?? "");
      })[0] ?? null
  );
}

export function rankMentionCandidates<T extends MentionCandidateForRanking>(
  candidates: readonly T[],
  query: string,
  activePersonaIds: ReadonlySet<string> = new Set(),
): RankedMentionCandidate<T>[] {
  const lowerQuery = query.toLowerCase();
  const sameName = sameNameAgents(candidates, activePersonaIds);

  return candidates
    .map((candidate, order) => {
      const pubkeyLower = candidate.pubkey
        ? normalizePubkey(candidate.pubkey)
        : "";
      const label =
        candidate.displayName ??
        (candidate.pubkey ? truncateNpub(candidate.pubkey) : "agent");
      const ownGroupRank = getMentionCandidateGroupRank(
        candidate,
        activePersonaIds,
      );
      // Among agents with one name, the one this device runs leads: a person
      // who picks another one gets no answer, however the roster is ordered.
      const sharedName = sameName.get(sameNameKey(candidate));
      const isLocalAmongSameName =
        candidate.isManagedAgent === true &&
        sharedName !== undefined &&
        sharedName.count > 1;
      const groupRank = isLocalAmongSameName
        ? Math.min(ownGroupRank, sharedName.bestGroupRank)
        : ownGroupRank;
      const localRank = isLocalAmongSameName ? 0 : 1;

      const labelScores = [
        candidate.displayName,
        candidate.personaName,
        candidate.secondaryLabel,
      ]
        .map((value) =>
          value ? scoreMentionCandidateLabel(value, lowerQuery) : null,
        )
        .filter((score): score is number => score !== null);
      const labelScore =
        labelScores.length > 0 ? Math.min(...labelScores) : null;

      const pubkeyScore = candidate.pubkey
        ? pubkeyLower.startsWith(lowerQuery)
          ? 4
          : pubkeyLower.includes(lowerQuery)
            ? 5
            : null
        : null;
      const score = labelScore !== null ? labelScore : pubkeyScore;

      return { candidate, groupRank, label, localRank, order, score };
    })
    .filter((item): item is RankedMentionCandidate<T> => item.score !== null)
    .sort(
      (a, b) =>
        a.groupRank - b.groupRank ||
        a.score - b.score ||
        a.localRank - b.localRank ||
        a.order - b.order,
    );
}
