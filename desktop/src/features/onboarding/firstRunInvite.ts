import { deriveCommunityName } from "@/features/communities/communityStorage";

import type { CommunityOnboardingTransaction } from "./communityOnboarding";

/**
 * A workspace invite held durably while the person finishes sign-up. It is
 * derived from the persisted community-onboarding transaction, so a restart
 * in the middle of account creation resumes on the same invite.
 */
export type FirstRunInvite = {
  relayUrl: string;
  code: string;
  policyReceipt?: string;
  /** Workspace name for display. Never the invite code. */
  businessName: string;
  /** One letter for the business mark. */
  initial: string;
};

const HEX_SUFFIX = /^[0-9a-f]{8,}$/i;

/**
 * Turn a relay host into a readable workspace name when the invite carries
 * only a host: `rosebank-studio.colony.example` becomes `Rosebank Studio`.
 * A trailing generated id (long hex run) is dropped.
 */
export function humanizeInviteHost(relayUrl: string): string {
  let host = "";
  try {
    host = new URL(
      relayUrl.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:"),
    ).hostname;
  } catch {
    return "your team";
  }
  const label = host.split(".")[0] ?? "";
  const words = label
    .split(/[-_]+/)
    .filter((word) => word.length > 0 && !HEX_SUFFIX.test(word));
  if (words.length === 0) return "your team";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * The invite to present during first-run setup, or null when nothing is
 * waiting. A claim that already failed is never presented: failed claims are
 * not persisted at all (see saveCommunityOnboardingTransaction).
 */
export function firstRunInviteFromTransaction(
  transaction: CommunityOnboardingTransaction | null,
): FirstRunInvite | null {
  if (!transaction) return null;
  const code = transaction.inviteCode?.trim();
  if (!code || transaction.stage !== "claiming" || transaction.error) {
    return null;
  }
  const isInviteSource =
    transaction.source === "deep-link-join" ||
    (transaction.source === "first-community" &&
      transaction.firstCommunityPage === "join");
  if (!isInviteSource) return null;
  const explicitName = transaction.communityName.trim();
  const businessName =
    explicitName && explicitName !== deriveCommunityName(transaction.relayUrl)
      ? explicitName
      : humanizeInviteHost(transaction.relayUrl);
  return {
    relayUrl: transaction.relayUrl,
    code,
    policyReceipt: transaction.policyReceipt,
    businessName,
    initial: businessName.charAt(0).toUpperCase() || "C",
  };
}

/**
 * A link opened (or pasted) after setup is offered as "Join <workspace>" first.
 * Nothing is claimed until the person confirms, and a confirmed or retried
 * claim (acknowledged, or any other source) proceeds without asking again.
 */
export function needsJoinConfirmation(
  transaction: CommunityOnboardingTransaction | null,
): boolean {
  return (
    transaction !== null &&
    transaction.source === "deep-link-join" &&
    transaction.stage === "claiming" &&
    !transaction.acknowledged &&
    !transaction.error &&
    Boolean(transaction.inviteCode?.trim())
  );
}
