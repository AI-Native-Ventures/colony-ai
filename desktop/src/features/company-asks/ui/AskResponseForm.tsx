import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
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
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { mapSpecializedAskCard } from "../askCardMapping";
import type { AskHeadRecord, AskOutcome } from "../askRecords";
import "./askDecisions.css";

type DecisionOption = {
  value: AskOutcome;
  label: string;
  tone: "ok" | "need" | "bad";
};

function decisionOptions(
  type: AskHeadRecord["head"]["ask"]["type"],
): DecisionOption[] | null {
  if (type === "approval") {
    return [
      { value: "approved", label: "Approve", tone: "ok" },
      { value: "revision_requested", label: "Request revision", tone: "need" },
      { value: "rejected", label: "Reject", tone: "bad" },
    ];
  }
  if (type === "tool_consent") {
    return [
      { value: "approved", label: "Approve", tone: "ok" },
      { value: "rejected", label: "Reject", tone: "bad" },
    ];
  }
  if (type === "verdict") {
    return [
      { value: "pass", label: "Pass", tone: "ok" },
      { value: "fail", label: "Fail", tone: "bad" },
    ];
  }
  return null;
}

export function AskResponseForm({
  record,
  layout = "inline",
  notice,
  actions,
}: {
  record: AskHeadRecord;
  /** `decision` is the Colony 3.0 page form; `inline` is the in-thread card form. */
  layout?: "inline" | "decision";
  /** A line shown above the buttons (the spending notice). */
  notice?: React.ReactNode;
  /** Links shown beside the submit button. */
  actions?: React.ReactNode;
}) {
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

  if (layout === "decision") {
    const options = decisionOptions(ask.type);
    const needsReason =
      ask.type === "approval" ||
      ask.type === "verdict" ||
      ask.type === "tool_consent";
    const submitLabel = submitting
      ? "Recording…"
      : error
        ? "Retry response"
        : (specializedVariant?.submitLabel ?? "Record response");
    return (
      <form
        className="colony-decision-form"
        data-ask-type={ask.type}
        onSubmit={(event) => void submit(event)}
      >
        {options ? (
          <fieldset className="colony-decision-fieldset">
            <legend>{ask.type === "verdict" ? "Verdict" : "Decision"}</legend>
            <div className="colony-decision-radios">
              {options.map((option) => (
                <label
                  className="colony-decision-radio"
                  data-checked={outcome === option.value}
                  data-tone={option.tone}
                  key={option.value}
                >
                  <input
                    checked={outcome === option.value}
                    name={`${idPrefix}-decision`}
                    onChange={() => updateForm(setOutcome, option.value)}
                    type="radio"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {needsReason ? (
          <div className="colony-decision-field">
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
              placeholder="Add a reason the team can see"
              required
              rows={ask.category === "money" ? 2 : 3}
              value={reason}
            />
            <small
              className="colony-decision-count"
              hidden={reason.length === 0 && !reasonInvalid}
              id={`${idPrefix}-reason-count`}
            >
              {Array.from(reason).length} / 1,000 characters · Required
            </small>
            {reasonInvalid ? (
              <span
                className="colony-decision-error"
                id={`${idPrefix}-reason-error`}
                role="alert"
              >
                A reason is required. Use 1 to 1,000 characters. Spaces alone
                are not a reason.
              </span>
            ) : null}
          </div>
        ) : null}
        {ask.type === "question" ? (
          <div className="colony-decision-field">
            <label htmlFor={`${idPrefix}-answer`}>Your answer</label>
            <textarea
              id={`${idPrefix}-answer`}
              maxLength={4000}
              onChange={(event) => updateForm(setAnswer, event.target.value)}
              required
              rows={3}
              value={answer}
            />
          </div>
        ) : null}
        {ask.type === "choice" ? (
          <div className="colony-decision-field">
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
          </div>
        ) : null}
        {ask.type === "checklist" ? (
          <fieldset className="colony-decision-checklist">
            <legend className="sr-only">Checklist response</legend>
            {(ask.items ?? []).map((item) => (
              <label key={item.id}>
                <input
                  checked={checkedIds.includes(item.id)}
                  onChange={(event) =>
                    toggleItem(item.id, event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {notice ? <p className="colony-decision-note">{notice}</p> : null}
        {error ? (
          <p className="colony-decision-submit-error" role="alert">
            <span>{error}</span>
            <span>Your response is kept.</span>
          </p>
        ) : null}
        <div className="colony-decision-actions">
          <Button
            className="colony-decision-submit"
            disabled={!readyToSubmit}
            type="submit"
          >
            {submitLabel}
          </Button>
          {actions}
        </div>
      </form>
    );
  }

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
