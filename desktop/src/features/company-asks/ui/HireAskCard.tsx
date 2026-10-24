import { Link } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { useCompanyHireHeadQuery } from "@/features/company-hiring/hireRelay";
import type { AskHeadRecord, HireProposal } from "../askRecords";
import {
  CannotRespond,
  DecisionAvatar,
  DecisionChip,
  DecisionContext,
} from "./AskDecisionParts";
import { OutcomeBody } from "./AskOutcomeCard";
import type { OutcomeActorView } from "./AskOutcomeCard";
import { formatClockTime, formatDeadline } from "./askCardFormatting";
import "./askDecisions.css";

type HireAskCardProps = {
  askId: string;
  channelId: string;
  channelName: string;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  membershipRole?: string | null;
  headRecord: AskHeadRecord;
  hireProposal: HireProposal;
  checksReady: boolean;
  deniedReason: string | null;
  accessFailure: boolean;
  isOverdue: boolean;
  statusText: string | undefined;
  needsYou: boolean;
  askerIsAgent: boolean;
};

export function HireAskCard({
  askId,
  channelId,
  channelName,
  currentPubkey,
  profiles,
  membershipRole,
  headRecord,
  hireProposal,
  checksReady,
  deniedReason,
  accessFailure,
  isOverdue,
  statusText,
  needsYou,
  askerIsAgent,
}: HireAskCardProps) {
  const { goHireReview } = useAppNavigation();
  const hireHeadQuery = useCompanyHireHeadQuery(hireProposal.hireId);

  const head = headRecord.head;
  const asker = resolveUserLabel({
    pubkey: head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const addresseePubkey = head.ask.addresseePubkey;
  const addresseeIsCurrentUser = Boolean(
    addresseePubkey &&
      currentPubkey &&
      normalizePubkey(addresseePubkey) === normalizePubkey(currentPubkey),
  );
  const addresseeProfile = addresseePubkey
    ? profiles?.[normalizePubkey(addresseePubkey)]
    : undefined;
  const addresseeRole = addresseeIsCurrentUser
    ? membershipRole === "owner"
      ? "Owner"
      : membershipRole === "admin"
        ? "Administrator"
        : null
    : null;
  const addresseeLabel = addresseePubkey
    ? addresseeIsCurrentUser
      ? `${addresseeProfile?.displayName ?? "You"}${addresseeRole ? ` · ${addresseeRole}` : ""}`
      : resolveUserLabel({
          pubkey: addresseePubkey,
          currentPubkey,
          profiles,
        })
    : "Owner or administrator";
  const hireDeclined =
    head.status === "resolved" && head.resolution?.outcome === "rejected";
  const hireApproved =
    head.status === "resolved" && head.resolution?.outcome === "approved";
  const founderReviewReady =
    hireApproved &&
    membershipRole === "owner" &&
    hireHeadQuery.data?.head.status === "awaiting_founder";

  const hireOutcome = hireDeclined || hireApproved;
  const statusLabel = hireDeclined
    ? "Request declined"
    : hireApproved
      ? "Approved"
      : (statusText ?? "Open");
  const statusTone = hireDeclined
    ? "bad"
    : hireApproved
      ? "ok"
      : isOverdue
        ? "bad"
        : "idle";
  const resolverPubkey = head.resolution?.resolvedByPubkey;
  const resolver: OutcomeActorView | null = resolverPubkey
    ? {
        pubkey: resolverPubkey,
        name: resolveUserLabel({
          pubkey: resolverPubkey,
          currentPubkey,
          profiles,
        }),
        isAgent: profiles?.[normalizePubkey(resolverPubkey)]?.isAgent === true,
      }
    : null;

  return (
    <section
      aria-label="Approval ask"
      className="colony-decision-layout"
      data-ask-id={askId}
      data-ask-variant="hire"
      data-testid="ask-card"
    >
      <div className="colony-decision-card" data-variant="funding">
        <div className="colony-decision-chips">
          <h2>Decision requested</h2>
          {needsYou ? (
            <DecisionChip testId="ask-needs-you" tone="need">
              Needs you
            </DecisionChip>
          ) : null}
          <DecisionChip testId="ask-status" tone={statusTone}>
            {statusLabel}
          </DecisionChip>
        </div>
        <div className="colony-decision-message">
          <DecisionAvatar
            isAgent={askerIsAgent}
            name={asker}
            profiles={profiles}
            pubkey={head.askerPubkey}
            size={42}
          />
          <div className="colony-decision-message-body">
            <div className="colony-decision-message-head">
              <strong>{asker}</strong>
              <span>
                {askerIsAgent ? "AI employee" : "Person"} · #{channelName}
                {formatClockTime(head.createdAt)
                  ? ` · ${formatClockTime(head.createdAt)}`
                  : ""}
              </span>
            </div>
            {head.ask.body ? (
              <p className="colony-decision-message-text">{head.ask.body}</p>
            ) : null}
          </div>
        </div>
        {hireOutcome ? (
          <div
            className="colony-outcome-body"
            data-outcome={hireDeclined ? "denied" : "resolved"}
          >
            {hireDeclined ? (
              <OutcomeBody
                canceller={null}
                head={head}
                profiles={profiles}
                resolver={resolver}
              />
            ) : (
              <strong>Decision recorded</strong>
            )}
            <p className="colony-outcome-by">
              {hireDeclined
                ? `No authority or funding changed. ${asker} will keep the work paused.`
                : "The requester has the outcome in the original thread."}
            </p>
          </div>
        ) : null}
        {head.status === "open" ? (
          checksReady && !deniedReason ? (
            <div className="colony-decision-actions">
              <Button
                className="colony-decision-submit"
                onClick={() =>
                  void goHireReview(hireProposal.hireId, {
                    channelId,
                    askId,
                  })
                }
                type="button"
              >
                Review hire
              </Button>
              <Button
                className="colony-decision-submit"
                onClick={() =>
                  void goHireReview(hireProposal.hireId, {
                    channelId,
                    askId,
                  })
                }
                type="button"
                variant="outline"
              >
                Decline
              </Button>
            </div>
          ) : (
            <CannotRespond
              alert={accessFailure}
              message={
                accessFailure
                  ? "Access could not be verified. Try again after the relay is available."
                  : !checksReady
                    ? "Checking whether you can respond…"
                    : (deniedReason ?? "")
              }
            />
          )
        ) : null}
        {head.status !== "open" ? (
          <div className="colony-decision-actions" data-passive="true">
            {founderReviewReady ? (
              <Button
                className="colony-decision-submit"
                data-testid="hire-founder-review"
                onClick={() =>
                  void goHireReview(hireProposal.hireId, { channelId, askId })
                }
                type="button"
              >
                Open founder review
              </Button>
            ) : null}
            <Link
              className="colony-decision-link"
              params={{ channelId }}
              search={{
                messageId: head.ask.threadRootEventId,
                threadRootId: head.ask.threadRootEventId,
                thread: head.ask.threadRootEventId,
              }}
              to="/channels/$channelId"
            >
              Open conversation
            </Link>
          </div>
        ) : null}
      </div>
      <DecisionContext
        addresseeName={addresseePubkey ? addresseeLabel : null}
        addresseePubkey={addresseePubkey ?? null}
        deadline={formatDeadline(head.ask.decideBy)}
        funding
        linkedWork={null}
        overdue={isOverdue}
        profiles={profiles}
      />
    </section>
  );
}
