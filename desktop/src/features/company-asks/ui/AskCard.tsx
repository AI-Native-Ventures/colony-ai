import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
  useStopManagedAgentMutation,
} from "@/features/agents/hooks";
import {
  isManagedAgentActive,
  stopManagedAgentWithRules,
} from "@/features/agents/lib/managedAgentControlActions";
import { clearActiveTurnsForAgentOnStop } from "@/features/agents/managedAgentRuntimeHooks";
import { useClientRecordsQuery } from "@/features/clients/useBusinessRecords";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useAskHeadQuery } from "../hooks";
import type { AskHeadQueryState } from "../hooks";
import { mapSpecializedAskCard } from "../askCardMapping";
import { DutyAskCard } from "./DutyAskCard";
import { HireAskCard } from "./HireAskCard";
import { formatAskDate } from "./askCardFormatting";
import { formatUsdCents } from "@/features/power/spendModels";
import type {
  AskHead,
  AskHeadRecord,
  AskOutcome,
  AskType,
} from "../askRecords";

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
  if (type === "tool_consent") return "Tool consent";
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
  if (head.ask.category !== "general") {
    if (isAgent)
      return "Agents cannot decide spending, hires, tools, secrets or duties";
    if (communityRole !== "owner" && communityRole !== "admin") {
      return "Only company owners and admins can decide this";
    }
    return null;
  }
  if (!channelMember) return "Only members of this conversation can answer";
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
    record.head.ask.type === "approval" ||
      record.head.ask.type === "tool_consent"
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
  const [reasonTouched, setReasonTouched] = React.useState(false);
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
  const reasonInvalid = reasonTouched && reason.trim().length === 0;
  const memberProposal = ask.memberProposal;
  const needsRuntimeStop =
    outcome === "approved" &&
    (memberProposal?.action === "pause" ||
      memberProposal?.action === "terminate");
  const managedAgentsQuery = useManagedAgentsQuery({
    enabled: needsRuntimeStop,
  });
  const relayAgentsQuery = useRelayAgentsQuery({ enabled: needsRuntimeStop });
  const channelsQuery = useChannelsQuery({ enabled: needsRuntimeStop });
  const stopManagedAgent = useStopManagedAgentMutation();
  const runtimeStoppedForHead = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (runtimeStoppedForHead.current !== currentHeadId) {
      runtimeStoppedForHead.current = null;
    }
  }, [currentHeadId]);

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
      if (needsRuntimeStop && memberProposal) {
        let managedAgent = managedAgentsQuery.data?.find(
          (candidate) =>
            normalizePubkey(candidate.pubkey) ===
            normalizePubkey(memberProposal.pubkey),
        );
        if (!managedAgent) {
          const refreshed = await managedAgentsQuery.refetch();
          managedAgent = refreshed.data?.find(
            (candidate) =>
              normalizePubkey(candidate.pubkey) ===
              normalizePubkey(memberProposal.pubkey),
          );
        }
        if (!managedAgent) {
          throw new Error(
            "The employee runtime cannot be stopped from this device, so the approval was not recorded.",
          );
        }
        if (
          isManagedAgentActive(managedAgent) &&
          runtimeStoppedForHead.current !== currentHeadId
        ) {
          const channels =
            channelsQuery.data ?? (await channelsQuery.refetch()).data ?? [];
          const relayAgents =
            relayAgentsQuery.data ??
            (await relayAgentsQuery.refetch()).data ??
            [];
          const result = await stopManagedAgentWithRules({
            agent: managedAgent,
            channels,
            relayAgents,
            stopManagedAgent: stopManagedAgent.mutateAsync,
          });
          if (result.noticeMessage) throw new Error(result.noticeMessage);
          clearActiveTurnsForAgentOnStop(memberProposal.pubkey);
        }
        runtimeStoppedForHead.current = currentHeadId;
      }
      let signedEvent = pendingEvent;
      if (!signedEvent) {
        const response = {
          schemaVersion: 1,
          askId: ask.askId,
          expectedHeadEventId: currentHeadId,
          outcome,
          ...(ask.type === "approval" ||
          ask.type === "verdict" ||
          ask.type === "tool_consent"
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
    (ask.type === "approval" ||
    ask.type === "verdict" ||
    ask.type === "tool_consent"
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
          <label htmlFor={`${idPrefix}-reason`}>Reason</label>
          <textarea
            aria-describedby={`${idPrefix}-reason-count${reasonInvalid ? ` ${idPrefix}-reason-error` : ""}`}
            aria-invalid={reasonInvalid}
            id={`${idPrefix}-reason`}
            maxLength={1000}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => {
              setReasonTouched(true);
              updateForm(setReason, event.target.value);
            }}
            required
            rows={3}
            value={reason}
          />
          <small id={`${idPrefix}-reason-count`}>
            {Array.from(reason).length} / 1,000 characters · Required
          </small>
          {reasonInvalid ? (
            <span
              className="colony-ask-compose-error"
              id={`${idPrefix}-reason-error`}
              role="alert"
            >
              A reason is required. Use 1 to 1,000 characters. Spaces alone are
              not a reason.
            </span>
          ) : null}
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
          <label htmlFor={`${idPrefix}-reason`}>Reason</label>
          <textarea
            aria-describedby={`${idPrefix}-reason-count${reasonInvalid ? ` ${idPrefix}-reason-error` : ""}`}
            aria-invalid={reasonInvalid}
            id={`${idPrefix}-reason`}
            maxLength={1000}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => {
              setReasonTouched(true);
              updateForm(setReason, event.target.value);
            }}
            required
            rows={3}
            value={reason}
          />
          <small id={`${idPrefix}-reason-count`}>
            {Array.from(reason).length} / 1,000 characters · Required
          </small>
          {reasonInvalid ? (
            <span
              className="colony-ask-compose-error"
              id={`${idPrefix}-reason-error`}
              role="alert"
            >
              A reason is required. Use 1 to 1,000 characters. Spaces alone are
              not a reason.
            </span>
          ) : null}
        </>
      ) : null}
      {ask.type === "tool_consent" ? (
        <>
          <label htmlFor={`${idPrefix}-decision`}>Decision</label>
          <select
            id={`${idPrefix}-decision`}
            onChange={(event) =>
              updateForm(
                setOutcome,
                event.target.value as "approved" | "rejected",
              )
            }
            value={outcome}
          >
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
          </select>
          <label htmlFor={`${idPrefix}-reason`}>Reason</label>
          <textarea
            aria-describedby={`${idPrefix}-reason-count${reasonInvalid ? ` ${idPrefix}-reason-error` : ""}`}
            aria-invalid={reasonInvalid}
            id={`${idPrefix}-reason`}
            maxLength={1000}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => {
              setReasonTouched(true);
              updateForm(setReason, event.target.value);
            }}
            required
            rows={3}
            value={reason}
          />
          <small id={`${idPrefix}-reason-count`}>
            {Array.from(reason).length} / 1,000 characters · Required
          </small>
          {reasonInvalid ? (
            <span
              className="colony-ask-compose-error"
              id={`${idPrefix}-reason-error`}
              role="alert"
            >
              A reason is required. Use 1 to 1,000 characters. Spaces alone are
              not a reason.
            </span>
          ) : null}
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
  const workItemSubjectId =
    head?.ask.subject?.kind === "workItem" ? head.ask.subject.id : null;
  const subjectWorkQuery = useClientRecordsQuery(
    channelId,
    Boolean(workItemSubjectId),
  );
  const matchingWorkItems =
    workItemSubjectId && subjectWorkQuery.workItemsQuery.data
      ? subjectWorkQuery.workItemsQuery.data.filter(
          (workItem) =>
            workItem.value.clientId === channelId &&
            workItem.value.workItemId === workItemSubjectId,
        )
      : [];
  const linkedWorkItem =
    matchingWorkItems.length === 1 ? matchingWorkItems[0] : null;

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
    (head.ask.category !== "general" || membersQuery.isSuccess) &&
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
    (head.ask.category === "general" && membersQuery.isError) ||
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
  const specializedDetail = Boolean(
    specializedVariant &&
      (!showDetailLink ||
        specializedVariant.kind === "hire" ||
        specializedVariant.kind === "duty"),
  );
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
  const allowanceProposal = head.ask.spendAllowanceProposal;
  const allowanceValue =
    allowanceProposal?.temporaryAllowance?.allowance ??
    allowanceProposal?.allowance;
  const allowanceProposalDetails =
    allowanceProposal && allowanceValue ? (
      <dl
        className="colony-ask-money-proposal-details"
        data-testid="ask-money-allowance-proposal"
      >
        <div>
          <dt>Employee</dt>
          <dd>
            {resolveUserLabel({
              pubkey: allowanceProposal.employeePubkey,
              currentPubkey,
              profiles,
              preferResolvedSelfLabel: Boolean(
                profiles?.[normalizePubkey(allowanceProposal.employeePubkey)],
              ),
            })}
          </dd>
        </div>
        <div>
          <dt>Requested allowance</dt>
          <dd>
            {formatUsdCents(allowanceValue.amountCents)} /{" "}
            {allowanceValue.period}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {allowanceProposal.temporaryAllowance ? "Temporary" : "Permanent"}
          </dd>
        </div>
        {allowanceProposal.temporaryAllowance ? (
          <div>
            <dt>End date</dt>
            <dd>
              {allowanceProposal.temporaryAllowance.expiresAt.slice(0, 10)}
            </dd>
          </div>
        ) : null}
      </dl>
    ) : null;

  const hireProposal = head.ask.hireProposal;
  if (
    specializedDetail &&
    specializedVariant?.kind === "hire" &&
    hireProposal
  ) {
    return (
      <HireAskCard
        accessFailure={accessFailure}
        askId={askId}
        askerIsAgent={askerIsAgent}
        channelId={channelId}
        channelName={channelName}
        checksReady={checksReady}
        currentPubkey={currentPubkey}
        deniedReason={deniedReason}
        headRecord={headRecord}
        hireProposal={hireProposal}
        isOverdue={isOverdue}
        membershipRole={membershipQuery.data?.role}
        needsYou={needsYou}
        profiles={profiles}
        query={query}
        statusText={statusText}
        key={askId}
      />
    );
  }

  const dutyProposal = head.ask.dutyProposal;
  if (
    specializedDetail &&
    specializedVariant?.kind === "duty" &&
    dutyProposal
  ) {
    return (
      <DutyAskCard
        accessFailure={accessFailure}
        askId={askId}
        askerIsAgent={askerIsAgent}
        channelId={channelId}
        channelName={channelName}
        checksReady={checksReady}
        currentPubkey={currentPubkey}
        deniedReason={deniedReason}
        headRecord={headRecord}
        isOverdue={isOverdue}
        needsYou={needsYou}
        profiles={profiles}
        query={query}
        statusText={statusText}
        key={askId}
      />
    );
  }

  return (
    <section
      aria-label={`${typeLabel(head.ask.type)} ask`}
      className={`colony-ask-card${specializedVariant ? ` colony-ask-card-${specializedVariant.kind}` : ""}${specializedDetail ? " colony-ask-card-specialized-detail" : ""}`}
      data-ask-id={askId}
      data-ask-variant={specializedVariant?.kind}
      data-testid="ask-card"
    >
      {specializedDetail ? (
        <div className="colony-ask-special-grid">
          <section
            aria-label="Decision requested"
            className="colony-ask-special-request"
          >
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
                className={`colony-ask-status colony-ask-status-${isOverdue ? "overdue" : head.status}`}
                data-testid="ask-status"
              >
                {needsYou ? "Needs you" : statusText}
              </span>
            </header>
            {head.ask.body ? (
              <p className="colony-ask-special-description">{head.ask.body}</p>
            ) : null}
            {allowanceProposalDetails}
            {head.ask.toolConsent ? (
              <p className="colony-ask-body" data-testid="tool-consent-preview">
                {head.ask.toolConsent.actionPreview}
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
              {linkedWorkItem ? (
                <div>
                  <dt>Linked work</dt>
                  <dd>{linkedWorkItem.value.title}</dd>
                </div>
              ) : null}
            </dl>
            {linkedWorkItem ? (
              <Link
                aria-label={`Open work item ${linkedWorkItem.value.title}`}
                className="colony-ask-special-work-link"
                params={{ workId: linkedWorkItem.value.workItemId }}
                search={{ client: linkedWorkItem.value.clientId }}
                to="/work/$workId"
              >
                Open work
              </Link>
            ) : null}
          </aside>
        </div>
      ) : specializedVariant ? (
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
      {!specializedDetail ? (
        <>
          {specializedVariant ? (
            <p className="colony-ask-special-kind">
              {specializedVariant.decisionTitle}
            </p>
          ) : null}
          <h2>{head.ask.title}</h2>
          {head.ask.body ? (
            <p className="colony-ask-body">{head.ask.body}</p>
          ) : null}
          {allowanceProposalDetails}
          {head.ask.toolConsent ? (
            <p className="colony-ask-body" data-testid="tool-consent-preview">
              {head.ask.toolConsent.actionPreview}
            </p>
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
        </>
      ) : null}
    </section>
  );
}
