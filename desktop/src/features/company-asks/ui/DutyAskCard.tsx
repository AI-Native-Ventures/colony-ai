import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { hirePrimaryButtonClass } from "@/features/company-hiring/ui/HirePresentation";
import type { AskHeadRecord } from "../askRecords";
import type { AskHeadQueryState } from "../hooks";
import { formatAskDate } from "./askCardFormatting";

type DutyAskCardProps = {
  askId: string;
  channelId: string;
  channelName: string;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  query: AskHeadQueryState["query"];
  headRecord: AskHeadRecord;
  checksReady: boolean;
  deniedReason: string | null;
  accessFailure: boolean;
  isOverdue: boolean;
  statusText: string | undefined;
  needsYou: boolean;
  askerIsAgent: boolean;
};

export function DutyAskCard({
  askId,
  channelId,
  channelName,
  currentPubkey,
  profiles,
  query,
  headRecord,
  checksReady,
  deniedReason,
  accessFailure,
  isOverdue,
  statusText,
  needsYou,
  askerIsAgent,
}: DutyAskCardProps) {
  const queryClient = useQueryClient();
  const [decisionState, setDecisionState] = React.useState({
    failed: false,
    pending: false,
  });
  const decisionGeneration = React.useRef(0);
  const head = headRecord.head;
  const currentHeadId = headRecord.event.id;
  const previousHeadId = React.useRef(currentHeadId);
  const asker = resolveUserLabel({
    pubkey: head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const askerProfile = profiles?.[normalizePubkey(head.askerPubkey)];
  const approved =
    head.status === "resolved" && head.resolution?.outcome === "approved";
  const rejected =
    head.status === "resolved" && head.resolution?.outcome === "rejected";
  const decisionFailed = decisionState.failed && head.status === "open";

  React.useEffect(() => {
    if (previousHeadId.current !== currentHeadId) {
      previousHeadId.current = currentHeadId;
      decisionGeneration.current += 1;
      setDecisionState({ failed: false, pending: false });
    }
    return () => {
      decisionGeneration.current += 1;
    };
  }, [currentHeadId]);

  const submitDecision = async (outcome: "approved" | "rejected") => {
    if (
      head.status !== "open" ||
      !checksReady ||
      deniedReason ||
      decisionState.pending
    ) {
      return;
    }
    const generation = ++decisionGeneration.current;
    const updateDecisionState = (patch: {
      failed?: boolean;
      pending?: boolean;
    }) => {
      if (generation !== decisionGeneration.current) return;
      setDecisionState((current) => ({ ...current, ...patch }));
    };
    updateDecisionState({ failed: false, pending: true });
    try {
      const signedResponse = await signRelayEvent({
        kind: KIND_ASK_RESPONSE,
        content: JSON.stringify({
          schemaVersion: 1,
          askId,
          expectedHeadEventId: currentHeadId,
          outcome,
        }),
        tags: [
          ["h", channelId],
          ["d", `channel:${channelId}:ask:${askId}`],
        ],
      });
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
          refreshed.data.head.resolution?.outcome !== outcome
        ) {
          throw cause;
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-ask-head", channelId, askId],
          exact: false,
        }),
        queryClient.invalidateQueries({ queryKey: ["employee-duties"] }),
        queryClient.invalidateQueries({ queryKey: ["workflows"] }),
        queryClient.invalidateQueries({ queryKey: ["workflows-all"] }),
      ]);
    } catch {
      updateDecisionState({ failed: true });
    } finally {
      updateDecisionState({ pending: false });
    }
  };

  const statusLabel = decisionFailed
    ? "failed"
    : rejected
      ? "denied"
      : approved
        ? "resolved"
        : isOverdue
          ? "overdue"
          : head.status;
  const addresseeLabel = head.ask.addresseePubkey
    ? resolveUserLabel({
        pubkey: head.ask.addresseePubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: Boolean(
          profiles?.[normalizePubkey(head.ask.addresseePubkey)],
        ),
      })
    : "Owner or administrator";

  return (
    <section
      aria-label="Approval ask"
      className="colony-ask-card colony-ask-card-duty colony-ask-card-specialized-detail"
      data-ask-id={askId}
      data-ask-variant="duty"
      data-testid="ask-card"
    >
      <div className="colony-ask-special-grid">
        <section aria-label="Duty ask" className="colony-ask-special-request">
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
              className={`colony-ask-status colony-ask-status-${statusLabel}`}
              data-testid="ask-status"
            >
              {decisionFailed
                ? "failed"
                : rejected
                  ? "denied"
                  : approved
                    ? "resolved"
                    : needsYou
                      ? "Needs you"
                      : (statusText ?? head.status)}
            </span>
          </header>
          {head.ask.body ? (
            <p className="colony-ask-special-description">{head.ask.body}</p>
          ) : null}
          {decisionFailed || rejected || approved ? (
            <div
              className="colony-ask-outcome"
              data-outcome={
                decisionFailed ? "failed" : rejected ? "denied" : "resolved"
              }
              role={decisionFailed ? "alert" : undefined}
            >
              <strong>
                {decisionFailed
                  ? "Decision could not be saved"
                  : rejected
                    ? "Request declined"
                    : "Decision recorded"}
              </strong>
              <p>
                {decisionFailed
                  ? "No action has been released. Your review is kept; retry once connected."
                  : rejected
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
                  disabled={decisionState.pending}
                  onClick={() => void submitDecision("approved")}
                  type="button"
                >
                  Approve duty
                </Button>
                <Button
                  className="colony-ask-special-work-link"
                  disabled={decisionState.pending}
                  onClick={() => void submitDecision("rejected")}
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
