import { firstName } from "@/features/channels/ui/DmAgentSubtitle";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * What the header says about the sender besides their name: their job title
 * and, for an agent, who manages it ("Social Media Manager · managed by
 * Lerato"). Shows only what is known. An agent with neither is marked "Agent"
 * so a person can still tell who is an AI.
 */
export function MessageAgentOwner({
  isAgent = true,
  jobTitle,
  ownerLabel,
  ownerPubkey,
  selfName,
  selfPubkey,
}: {
  isAgent?: boolean;
  jobTitle?: string | null;
  ownerLabel?: string | null;
  ownerPubkey?: string | null;
  selfName?: string | null;
  /** Needed to name you when the agent is yours and the lookup has no name. */
  selfPubkey?: string | null;
}) {
  const needsSelfName =
    ownerLabel === "you" && !selfName && Boolean(selfPubkey);
  const selfQuery = useUsersBatchQuery(
    needsSelfName && selfPubkey ? [selfPubkey] : [],
    {
      enabled: needsSelfName,
    },
  );
  const resolvedSelfName =
    selfName ??
    (selfPubkey
      ? selfQuery.data?.profiles[normalizePubkey(selfPubkey)]?.displayName
      : null);
  const managedBy =
    isAgent && ownerPubkey && ownerLabel
      ? ownerLabel === "you"
        ? (firstName(resolvedSelfName) ?? "you")
        : (firstName(ownerLabel) ?? ownerLabel)
      : null;

  if (!jobTitle && !managedBy) {
    return isAgent ? (
      <span
        aria-hidden="true"
        className="colony-agent-badge c3c-sender-meta min-w-0 truncate"
        data-testid="message-agent-owner"
      >
        Agent
      </span>
    ) : null;
  }

  return (
    <span
      className="c3c-sender-meta inline-flex min-w-0 items-baseline gap-x-1"
      data-testid={isAgent ? "message-agent-owner" : "message-job-title"}
    >
      <span className="sr-only">
        {isAgent ? (managedBy ? "Agent managed by" : "Agent") : "Job title"}
      </span>
      {jobTitle ? <span className="truncate">{jobTitle}</span> : null}
      {jobTitle && managedBy ? <span aria-hidden="true">·</span> : null}
      {managedBy && ownerPubkey ? (
        <>
          <span aria-hidden="true" className="shrink-0">
            managed by
          </span>
          <UserProfilePopover
            pubkey={ownerPubkey}
            triggerAriaLabel={ownerLabel ?? managedBy}
            triggerElement="span"
          >
            <span className="min-w-0 truncate rounded hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              {managedBy}
            </span>
          </UserProfilePopover>
        </>
      ) : null}
    </span>
  );
}
