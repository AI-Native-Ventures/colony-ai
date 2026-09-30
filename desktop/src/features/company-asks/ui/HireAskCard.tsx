import { Link } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { hirePrimaryButtonClass } from "@/features/company-hiring/ui/HirePresentation";
import { useCompanyHireHeadQuery } from "@/features/company-hiring/hireRelay";
import type { AskHeadRecord, HireProposal } from "../askRecords";
import { formatAskDate } from "./askCardFormatting";

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
  const askerProfile = profiles?.[normalizePubkey(head.askerPubkey)];
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

  return (
    <section
      aria-label="Approval ask"
      className="colony-ask-card colony-ask-card-hire colony-ask-card-specialized-detail"
      data-ask-id={askId}
      data-ask-variant="hire"
      data-testid="ask-card"
    >
      <div className="colony-ask-special-grid">
        <section aria-label="Hire ask" className="colony-ask-special-request">
          <h2>Decision requested</h2>
          <header className="colony-ask-special-header">
            <div className="colony-ask-special-identity">
              <span aria-hidden="true">
                <UserAvatar
                  avatarUrl={askerProfile?.avatarUrl ?? null}
                  displayName={asker}
                  size="md"
                />
              </span>
              <div>
                <strong>{asker}</strong>
                <p>
                  {askerIsAgent ? "AI employee" : "Person"} · #{channelName} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(Date.parse(head.createdAt)))}
                </p>
              </div>
            </div>
            <span
              className={`colony-ask-status colony-ask-status-${hireDeclined ? "denied" : hireApproved ? "resolved" : isOverdue ? "overdue" : head.status}`}
              data-testid="ask-status"
            >
              {hireDeclined
                ? "denied"
                : hireApproved
                  ? "resolved"
                  : needsYou
                    ? "Needs you"
                    : statusText}
            </span>
          </header>
          {head.ask.body ? (
            <p className="colony-ask-special-description">{head.ask.body}</p>
          ) : null}
          {hireDeclined || hireApproved ? (
            <div
              className="colony-ask-hire-outcome"
              data-outcome={hireDeclined ? "denied" : "resolved"}
            >
              <strong>
                {hireDeclined ? "Request declined" : "Decision recorded"}
              </strong>
              <p>
                {hireDeclined
                  ? `No authority or funding changed. ${asker} will keep the work paused.`
                  : "The requester has the outcome in the original thread."}
              </p>
            </div>
          ) : null}
          {head.status === "open" ? (
            checksReady && !deniedReason ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  className={hirePrimaryButtonClass}
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
                  className="colony-ask-special-work-link"
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
              <div
                className="colony-ask-denied"
                data-testid="ask-cannot-resolve"
                role={accessFailure ? "alert" : "status"}
              >
                <strong>You can view this ask, but cannot respond.</strong>
                <p>
                  {accessFailure
                    ? "Access could not be verified. Try again after the relay is available."
                    : !checksReady
                      ? "Checking whether you can respond…"
                      : deniedReason}
                </p>
              </div>
            )
          ) : null}
          {head.status !== "open" ? (
            <div className="flex flex-wrap items-center gap-3">
              {founderReviewReady ? (
                <Button
                  className={hirePrimaryButtonClass}
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
                className="colony-ask-special-work-link"
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
        </section>
        <aside
          aria-label="Decision context"
          className="colony-ask-special-context"
        >
          <h2>Decision context</h2>
          <dl>
            <div>
              <dt>Addressed to</dt>
              <dd>{addresseeLabel}</dd>
            </div>
            <div>
              <dt>Can decide</dt>
              <dd>Owner or administrator</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>
                {head.ask.decideBy
                  ? (formatAskDate(head.ask.decideBy) ?? head.ask.decideBy)
                  : "No deadline"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
