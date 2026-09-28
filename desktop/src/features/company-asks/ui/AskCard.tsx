import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useRelayAgentsQuery } from "@/features/agents/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useAskHeadQuery } from "../hooks";
import type { AskHeadQueryState } from "../hooks";
import { mapSpecializedAskCard } from "../askCardMapping";
import type {
  AskHead,
  AskHeadRecord,
  AskOutcome,
  AskType,
} from "../askRecords";

const KIND_ASK_RESPONSE = 47033;

function formatAskDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (first: Date, second: Date) =>
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
  const day = sameDay(date, today)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
}

function outcomeLabel(outcome: AskOutcome) {
  switch (outcome) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "revision_requested":
      return "Revision requested";
    case "answered":
      return "Answered";
    case "chosen":
      return "Choice recorded";
    case "confirmed":
      return "Checklist confirmed";
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
  }
}

function typeLabel(type: AskType) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function accessReason(input: {
  head: AskHead;
  channelMember: boolean;
  isAgent: boolean;
  pubkey: string;
  communityRole: string | null;
}) {
  const { head, channelMember, isAgent, pubkey, communityRole } = input;
  if (!channelMember) return "Only members of this conversation can answer";
  if (head.ask.category !== "general") {
    if (isAgent)
      return "Agents cannot decide spending, hires, tools or secrets";
    if (communityRole !== "owner" && communityRole !== "admin") {
      return "Only company owners and admins can decide this";
    }
    return null;
  }
  const addressee = head.ask.addresseePubkey;
  if (addressee) {
    if (normalizePubkey(addressee) !== normalizePubkey(pubkey)) {
      return "This ask is addressed to someone else";
    }
    if (
      isAgent &&
      head.ask.type !== "question" &&
      head.ask.type !== "verdict"
    ) {
      return "Agents can only answer questions and verdicts";
    }
    return null;
  }
  if (isAgent)
    return "Only people can answer an ask that is not addressed to anyone";
  return null;
}

function AskResponseForm({ record }: { record: AskHeadRecord }) {
  const idPrefix = React.useId();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = React.useState<AskOutcome>(
    record.head.ask.type === "approval"
      ? "approved"
      : record.head.ask.type === "verdict"
        ? "pass"
        : record.head.ask.type === "choice"
          ? "chosen"
          : record.head.ask.type === "checklist"
            ? "confirmed"
            : "answered",
  );
  const [reason, setReason] = React.useState("");
  const [answer, setAnswer] = React.useState("");
  const [optionId, setOptionId] = React.useState("");
  const [checkedIds, setCheckedIds] = React.useState<string[]>([]);
  const [pendingEvent, setPendingEvent] = React.useState<Awaited<
    ReturnType<typeof signRelayEvent>
  > | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const ask = record.head.ask;
  const specializedVariant = mapSpecializedAskCard(ask);
  const currentHeadId = record.event.id;

  React.useEffect(() => {
    if (!pendingEvent) return;
    try {
      const content = JSON.parse(pendingEvent.content) as {
        expectedHeadEventId?: string;
      };
      if (content.expectedHeadEventId !== currentHeadId) {
        setPendingEvent(null);
      }
    } catch {
      setPendingEvent(null);
    }
  }, [currentHeadId, pendingEvent]);

  const updateForm = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPendingEvent(null);
    setError(null);
  };

  const toggleItem = (itemId: string, checked: boolean) => {
    setCheckedIds((current) =>
      checked
        ? [...new Set([...current, itemId])]
        : current.filter((value) => value !== itemId),
    );
    setPendingEvent(null);
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let signedEvent = pendingEvent;
      if (!signedEvent) {
        const response = {
          schemaVersion: 1,
          askId: ask.askId,
          expectedHeadEventId: currentHeadId,
          outcome,
          ...(ask.type === "approval" || ask.type === "verdict"
            ? { reason: reason.trim() }
            : {}),
          ...(ask.type === "question" ? { answer: answer.trim() } : {}),
          ...(ask.type === "choice" ? { optionId } : {}),
          ...(ask.type === "checklist" ? { checkedItemIds: checkedIds } : {}),
        };
        signedEvent = await signRelayEvent({
          kind: KIND_ASK_RESPONSE,
          content: JSON.stringify(response),
          tags: [
            ["h", record.channelId],
            ["d", `channel:${record.channelId}:ask:${ask.askId}`],
          ],
        });
        setPendingEvent(signedEvent);
      }
      await relayClient.publishEvent(
        signedEvent,
        "The ask response timed out before the relay confirmed it.",
        "The ask response could not be sent.",
      );
      setPendingEvent(null);
      await queryClient.invalidateQueries({
        queryKey: ["company-ask-head", record.channelId, ask.askId],
        exact: false,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The response was not recorded. Your answers are kept; you can retry.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const readyToSubmit =
    (ask.type === "approval" || ask.type === "verdict"
      ? reason.trim().length > 0
      : ask.type === "question"
        ? answer.trim().length > 0
        : ask.type === "choice"
          ? Boolean(optionId)
          : (ask.items?.length ?? 0) > 0 &&
            checkedIds.length === ask.items?.length) && !submitting;

  return (
    <form
      className="colony-ask-response-form"
      onSubmit={(event) => void submit(event)}
    >
      {ask.type === "approval" ? (
        <>
          <label htmlFor={`${idPrefix}-decision`}>Decision</label>
          <select
            id={`${idPrefix}-decision`}
            onChange={(event) =>
              updateForm(
                setOutcome,
                event.target.value as
                  | "approved"
                  | "revision_requested"
                  | "rejected",
              )
            }
            value={outcome}
          >
            <option value="approved">Approve</option>
            <option value="revision_requested">Request revision</option>
            <option value="rejected">Reject</option>
          </select>
          <label htmlFor={`${idPrefix}-reason`}>
            Reason or requested changes
          </label>
          <textarea
            id={`${idPrefix}-reason`}
            maxLength={1000}
            onChange={(event) => updateForm(setReason, event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </>
      ) : null}
      {ask.type === "verdict" ? (
        <>
          <label htmlFor={`${idPrefix}-decision`}>Verdict</label>
          <select
            id={`${idPrefix}-decision`}
            onChange={(event) =>
              updateForm(setOutcome, event.target.value as "pass" | "fail")
            }
            value={outcome}
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
          <label htmlFor={`${idPrefix}-reason`}>
            Reason and evidence checked
          </label>
          <textarea
            id={`${idPrefix}-reason`}
            maxLength={1000}
            onChange={(event) => updateForm(setReason, event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </>
      ) : null}
      {ask.type === "question" ? (
        <>
          <label htmlFor={`${idPrefix}-answer`}>Your answer</label>
          <textarea
            id={`${idPrefix}-answer`}
            maxLength={4000}
            onChange={(event) => updateForm(setAnswer, event.target.value)}
            required
            rows={3}
            value={answer}
          />
        </>
      ) : null}
      {ask.type === "choice" ? (
        <>
          <label htmlFor={`${idPrefix}-choice`}>Choose a direction</label>
          <select
            id={`${idPrefix}-choice`}
            onChange={(event) => updateForm(setOptionId, event.target.value)}
            required
            value={optionId}
          >
            <option value="">Choose an option</option>
            {(ask.options ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {ask.type === "checklist" ? (
        <fieldset className="colony-ask-checklist">
          <legend className="sr-only">Checklist response</legend>
          {(ask.items ?? []).map((item) => (
            <label key={item.id}>
              <input
                checked={checkedIds.includes(item.id)}
                onChange={(event) => toggleItem(item.id, event.target.checked)}
                type="checkbox"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <p className="colony-ask-submit-error" role="alert">
          <span>{error}</span>
          <span className="colony-ask-kept-input">Your response is kept.</span>
        </p>
      ) : null}
      <Button
        className="colony-ask-submit-button"
        disabled={!readyToSubmit}
        type="submit"
      >
        {submitting
          ? "Recording…"
          : error
            ? "Retry response"
            : (specializedVariant?.submitLabel ?? "Record response")}
      </Button>
    </form>
  );
}

function AskResolution({
  head,
  currentPubkey,
  profiles,
}: {
  head: AskHead;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
}) {
  if (head.status === "cancelled" && head.cancellation) {
    const name = resolveUserLabel({
      pubkey: head.cancellation.cancelledByPubkey,
      currentPubkey,
      profiles,
    });
    return (
      <div className="colony-ask-resolution" data-testid="ask-cancelled">
        <strong>Cancelled by {name}</strong>
        <p>{head.cancellation.reason}</p>
        <small>{formatAskDate(head.cancellation.cancelledAt)}</small>
      </div>
    );
  }
  const resolution = head.resolution;
  if (head.status !== "resolved" || !resolution) return null;
  const name = resolveUserLabel({
    pubkey: resolution.resolvedByPubkey,
    currentPubkey,
    profiles,
  });
  const chosenOption = head.ask.options?.find(
    (option) => option.id === resolution.optionId,
  );
  const details =
    resolution.answer ??
    chosenOption?.label ??
    resolution.reason ??
    (resolution.checkedItemIds ? "All checklist items confirmed." : null);
  return (
    <div className="colony-ask-resolution" data-testid="ask-resolved">
      <strong>
        {outcomeLabel(resolution.outcome)} by {name}
      </strong>
      {details ? <p>{details}</p> : null}
      <small>{formatAskDate(resolution.resolvedAt)}</small>
    </div>
  );
}

export function AskCard({
  askId,
  channelId,
  currentPubkey,
  profiles,
  queryState,
  showDetailLink = true,
}: {
  askId: string;
  channelId: string | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  queryState?: AskHeadQueryState;
  showDetailLink?: boolean;
}) {
  const localQueryState = useAskHeadQuery(
    channelId,
    askId,
    queryState === undefined,
  );
  const { query, relaySelfQuery, liveState } = queryState ?? localQueryState;
  const channelsQuery = useChannelsQuery();
  const membersQuery = useChannelMembersQuery(channelId, Boolean(channelId));
  const membershipQuery = useMyRelayMembershipQuery();
  const agentsQuery = useRelayAgentsQuery({ enabled: Boolean(channelId) });
  const identityQuery = useIdentityQuery();
  const resolverPubkey = identityQuery.data?.pubkey ?? currentPubkey;
  const headRecord = query.data;
  const head = headRecord?.head;

  if (!channelId) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-unavailable"
      >
        <p role="status">Open this discussion to view the ask.</p>
      </section>
    );
  }
  if (
    relaySelfQuery.isError ||
    (relaySelfQuery.isSuccess && !relaySelfQuery.data)
  ) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-unavailable"
      >
        <p role="alert">
          The relay identity is unavailable, so this ask cannot be verified.
        </p>
        <Button
          onClick={() => void relaySelfQuery.refetch()}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </section>
    );
  }
  if (relaySelfQuery.isPending) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-loading"
      >
        <p role="status">Checking the relay-signed ask…</p>
      </section>
    );
  }
  if (query.isPending) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-loading"
      >
        <p role="status">Loading the latest ask…</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-error"
      >
        <p role="alert">
          {query.error instanceof Error
            ? query.error.message
            : "The ask could not be loaded."}
        </p>
        <Button
          onClick={() => void query.refetch()}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </section>
    );
  }
  if (!head || !headRecord) {
    return (
      <section
        aria-label="Ask"
        className="colony-ask-card"
        data-testid="ask-card-missing"
      >
        <p role="status">This ask is no longer available.</p>
      </section>
    );
  }

  const channelMember =
    resolverPubkey !== undefined &&
    membersQuery.data?.some(
      (member) =>
        normalizePubkey(member.pubkey) === normalizePubkey(resolverPubkey),
    ) === true;
  const currentIsAgent =
    resolverPubkey !== undefined &&
    agentsQuery.data?.some(
      (agent) =>
        normalizePubkey(agent.pubkey) === normalizePubkey(resolverPubkey),
    ) === true;
  const checksReady =
    Boolean(resolverPubkey) &&
    identityQuery.isSuccess &&
    membersQuery.isSuccess &&
    membershipQuery.isSuccess &&
    agentsQuery.isSuccess &&
    relaySelfQuery.isSuccess &&
    relaySelfQuery.data !== null;
  const deniedReason =
    checksReady && resolverPubkey
      ? accessReason({
          head,
          channelMember,
          isAgent: currentIsAgent,
          pubkey: resolverPubkey,
          communityRole: membershipQuery.data?.role ?? null,
        })
      : null;
  const accessFailure =
    identityQuery.isError ||
    membersQuery.isError ||
    membershipQuery.isError ||
    agentsQuery.isError ||
    relaySelfQuery.isError ||
    relaySelfQuery.data === null;
  const isOverdue =
    head.status === "open" &&
    Boolean(head.ask.decideBy) &&
    Date.parse(head.ask.decideBy ?? "") < Date.now();
  const statusText = isOverdue
    ? "Overdue · still open"
    : head.status === "resolved" && head.resolution
      ? outcomeLabel(head.resolution.outcome)
      : head.status;
  const specializedVariant = mapSpecializedAskCard(head.ask);
  const asker = resolveUserLabel({
    pubkey: head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const askerProfile = profiles?.[normalizePubkey(head.askerPubkey)];
  const askerIsAgent =
    askerProfile?.isAgent === true ||
    agentsQuery.data?.some(
      (agent) =>
        normalizePubkey(agent.pubkey) === normalizePubkey(head.askerPubkey),
    ) === true;
  const channelName =
    channelsQuery.data?.find((channel) => channel.id === channelId)?.name ??
    "conversation";
  const needsYou = head.status === "open" && checksReady && !deniedReason;
  const decisionHeading =
    head.status === "open"
      ? "Decision requested"
      : head.status === "resolved"
        ? "Decision recorded"
        : "Decision withdrawn";

  return (
    <section
      aria-label={`${typeLabel(head.ask.type)} ask`}
      className={`colony-ask-card${specializedVariant ? ` colony-ask-card-${specializedVariant.kind}` : ""}`}
      data-ask-id={askId}
      data-ask-variant={specializedVariant?.kind}
      data-testid="ask-card"
    >
      {specializedVariant ? (
        <>
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
                <h3>{decisionHeading}</h3>
                <p>
                  Proposed by {asker} ·{" "}
                  {askerIsAgent ? "AI employee" : "Person"} · #{channelName} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(Date.parse(head.createdAt)))}
                </p>
              </div>
            </div>
            <span
              className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
              data-testid="ask-status"
            >
              {needsYou ? "Needs you" : statusText}
            </span>
          </header>
          <dl className="colony-ask-special-context">
            <div>
              <dt>Addressed to</dt>
              <dd>
                {head.ask.addresseePubkey
                  ? resolveUserLabel({
                      pubkey: head.ask.addresseePubkey,
                      currentPubkey,
                      profiles,
                      preferResolvedSelfLabel: Boolean(
                        profiles?.[normalizePubkey(head.ask.addresseePubkey)],
                      ),
                    })
                  : "Owner or administrator"}
              </dd>
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
        </>
      ) : (
        <div className="colony-ask-meta">
          <span
            className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
            data-testid="ask-status"
          >
            {statusText}
          </span>
          <span>{head.ask.type}</span>
          {head.ask.decideBy ? (
            <span>
              Decide by {formatAskDate(head.ask.decideBy) ?? head.ask.decideBy}
            </span>
          ) : null}
        </div>
      )}
      {specializedVariant ? (
        <p className="colony-ask-special-kind">
          {specializedVariant.decisionTitle}
        </p>
      ) : null}
      <h2>{head.ask.title}</h2>
      {head.ask.body ? (
        <p className="colony-ask-body">{head.ask.body}</p>
      ) : null}
      {!specializedVariant && head.ask.addresseePubkey ? (
        <p className="colony-ask-addressed">
          Addressed to{" "}
          {resolveUserLabel({
            pubkey: head.ask.addresseePubkey,
            currentPubkey,
            profiles,
            preferResolvedSelfLabel: Boolean(
              profiles?.[normalizePubkey(head.ask.addresseePubkey)],
            ),
          })}
          .{" "}
          {head.ask.category === "money"
            ? "Only an authorized human may resolve spending decisions."
            : head.ask.category === "general"
              ? "The named recipient can respond."
              : "Only an authorized human may resolve this ask."}
        </p>
      ) : null}
      {head.status === "open" ? (
        checksReady && !deniedReason ? (
          <AskResponseForm record={headRecord} />
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
      ) : (
        <AskResolution
          currentPubkey={currentPubkey}
          head={head}
          profiles={profiles}
        />
      )}
      {liveState === "unavailable" && head.status === "open" ? (
        <p className="colony-ask-live-status" role="status">
          Live updates are unavailable. The ask will refresh when the relay
          reconnects.
        </p>
      ) : null}
      {showDetailLink && channelId ? (
        <Link
          className="colony-ask-detail-link"
          data-testid="ask-detail-link"
          params={{ askId, channelId }}
          to="/asks/$channelId/$askId"
        >
          Open decision
        </Link>
      ) : null}
    </section>
  );
}
