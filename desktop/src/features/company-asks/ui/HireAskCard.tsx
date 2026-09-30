import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { hirePrimaryButtonClass } from "@/features/company-hiring/ui/HirePresentation";
import type { AskHeadRecord, HireProposal } from "../askRecords";
import type { AskHeadQueryState } from "../hooks";
import { formatAskDate } from "./askCardFormatting";

type HireAskCardProps = {
  askId: string;
  channelId: string;
  channelName: string;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  membershipRole?: string | null;
  query: AskHeadQueryState["query"];
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
  query,
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
  const queryClient = useQueryClient();
  const { goHireReview } = useAppNavigation();
  const declineReasonId = React.useId();
  const [declineState, setDeclineState] = React.useState({
    failed: false,
    pending: false,
  });
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const [declineError, setDeclineError] = React.useState<string | null>(null);
  const [pendingDeclineEvent, setPendingDeclineEvent] = React.useState<Awaited<
    ReturnType<typeof signRelayEvent>
  > | null>(null);
  const declineGeneration = React.useRef(0);
  React.useEffect(() => {
    declineGeneration.current += 1;
    return () => {
      declineGeneration.current += 1;
    };
  }, []);
  React.useEffect(() => {
    if (!pendingDeclineEvent) return;
    try {
      const content = JSON.parse(pendingDeclineEvent.content) as {
        expectedHeadEventId?: string;
      };
      if (content.expectedHeadEventId === headRecord.event.id) return;
    } catch {
      // A malformed local event cannot be retried against a new head.
    }
    setPendingDeclineEvent(null);
    setDeclineError(null);
  }, [headRecord.event.id, pendingDeclineEvent]);

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
  const declinePending = declineState.pending;
  const hireDeclined =
    head.status === "resolved" && head.resolution?.outcome === "rejected";
  const hireApproved =
    head.status === "resolved" && head.resolution?.outcome === "approved";
  const decisionFailed = declineState.failed && head.status === "open";

  const declineHire = async () => {
    if (!checksReady || deniedReason || declinePending) return;
    if (!declineReason.trim()) {
      setDeclineError(
        "A reason is required. Use 1 to 1,000 characters. Spaces alone are not a reason.",
      );
      return;
    }
    const generation = declineGeneration.current;
    const updateDeclineState = (patch: {
      failed?: boolean;
      pending?: boolean;
    }) => {
      if (generation !== declineGeneration.current) return;
      setDeclineState((current) => ({ ...current, ...patch }));
    };
    updateDeclineState({ failed: false, pending: true });
    setDeclineError(null);
    try {
      let signedResponse = pendingDeclineEvent;
      if (!signedResponse) {
        signedResponse = await signRelayEvent({
          kind: KIND_ASK_RESPONSE,
          content: JSON.stringify({
            schemaVersion: 1,
            askId,
            expectedHeadEventId: headRecord.event.id,
            outcome: "rejected",
            reason: declineReason.trim(),
          }),
          tags: [
            ["h", channelId],
            ["d", `channel:${channelId}:ask:${askId}`],
          ],
        });
        setPendingDeclineEvent(signedResponse);
      }
      try {
        await relayClient.publishEvent(
          signedResponse,
          "The ask response timed out before the relay confirmed it.",
          "The ask response could not be sent.",
        );
      } catch (cause) {
        const refreshed = await query.refetch();
        if (
          refreshed.data?.head.status !== "resolved" ||
          refreshed.data.head.resolution?.outcome !== "rejected"
        ) {
          throw cause;
        }
      }
      setPendingDeclineEvent(null);
      setDeclineOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-ask-head", channelId, askId],
          exact: false,
        }),
        queryClient.invalidateQueries({ queryKey: ["company-hire-head"] }),
      ]);
    } catch (cause) {
      setDeclineError(
        cause instanceof Error
          ? cause.message
          : "The decision was not recorded. Your reason is kept; you can retry.",
      );
      updateDeclineState({ failed: true });
    } finally {
      updateDeclineState({ pending: false });
    }
  };

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
              className={`colony-ask-status colony-ask-status-${decisionFailed ? "failed" : hireDeclined ? "denied" : hireApproved ? "resolved" : isOverdue ? "overdue" : head.status}`}
              data-testid="ask-status"
            >
              {decisionFailed
                ? "failed"
                : hireDeclined
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
          {decisionFailed || hireDeclined || hireApproved ? (
            <div
              className="colony-ask-outcome"
              data-outcome={
                decisionFailed ? "failed" : hireDeclined ? "denied" : "resolved"
              }
              role={decisionFailed ? "alert" : undefined}
            >
              <strong>
                {decisionFailed
                  ? "Decision could not be saved"
                  : hireDeclined
                    ? "Request declined"
                    : "Decision recorded"}
              </strong>
              <p>
                {decisionFailed
                  ? "No action has been released. Your review is kept; retry once connected."
                  : hireDeclined
                    ? `No authority or funding changed. ${asker} will keep the work paused.`
                    : "The requester has the outcome in the original thread."}
              </p>
              {!decisionFailed && head.resolution?.reason ? (
                <p>{head.resolution.reason}</p>
              ) : null}
            </div>
          ) : null}
          {head.status === "open" ? (
            checksReady && !deniedReason ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  className={hirePrimaryButtonClass}
                  disabled={declinePending}
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
                  disabled={declinePending}
                  onClick={() => setDeclineOpen((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  {declineOpen ? "Cancel decline" : "Decline"}
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
          {head.status === "open" && declineOpen ? (
            <form
              className="colony-ask-compose-form colony-hire-decline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void declineHire();
              }}
            >
              <label htmlFor={`${declineReasonId}-reason`}>Reason</label>
              <textarea
                aria-describedby={`${declineReasonId}-count${declineError ? ` ${declineReasonId}-error` : ""}`}
                aria-invalid={Boolean(declineError)}
                disabled={declinePending}
                id={`${declineReasonId}-reason`}
                maxLength={1000}
                onChange={(event) => {
                  setDeclineReason(event.target.value);
                  setDeclineError(null);
                  setPendingDeclineEvent(null);
                }}
                required
                rows={3}
                value={declineReason}
              />
              <small id={`${declineReasonId}-count`}>
                {Array.from(declineReason).length} / 1,000 characters · Required
              </small>
              {declineError ? (
                <span
                  className="colony-ask-compose-error"
                  id={`${declineReasonId}-error`}
                  role="alert"
                >
                  {declineError}
                </span>
              ) : null}
              <Button
                disabled={!declineReason.trim() || declinePending}
                type="submit"
              >
                {declinePending
                  ? "Recording…"
                  : pendingDeclineEvent
                    ? "Retry decline"
                    : "Decline request"}
              </Button>
            </form>
          ) : null}
          {head.status !== "open" ? (
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
