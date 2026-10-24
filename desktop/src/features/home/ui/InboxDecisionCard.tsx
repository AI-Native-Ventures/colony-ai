import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { needsMeAskLabel } from "@/features/company-asks/askCardMapping";
import { useAskHeadsQuery } from "@/features/company-asks/hooks";
import type {
  AskHeadRecord,
  AskOutcome,
} from "@/features/company-asks/askRecords";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { KIND_ASK_RESPONSE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

const CLOCK_24H = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function sameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/** "Decide by today, 14:00" or "Decide by Sat 24 Oct, 12:00". */
function decideByText(decideBy: string | null | undefined): string | null {
  if (!decideBy) return null;
  const timestamp = Date.parse(decideBy);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const clock = CLOCK_24H.format(date);
  if (sameDay(date, new Date())) return `Decide by today, ${clock}`;
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(",", "");
  return `Decide by ${day}, ${clock}`;
}

type PendingDecision = "approved" | "revision_requested";

function DecisionCard({
  currentPubkey,
  profiles,
  record,
}: {
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  record: AskHeadRecord;
}) {
  const queryClient = useQueryClient();
  const { goAskDetail } = useAppNavigation();
  const [pending, setPending] = React.useState<PendingDecision | null>(null);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reasonInputRef = React.useRef<HTMLInputElement>(null);
  const ask = record.head.ask;
  const addressee = ask.addresseePubkey ?? null;
  const addressedToMe =
    addressee === null ||
    (currentPubkey !== undefined &&
      normalizePubkey(addressee) === normalizePubkey(currentPubkey));
  const addresseeLabel = addressee
    ? resolveUserLabel({ currentPubkey, profiles, pubkey: addressee })
    : "everyone in the conversation";
  const canDecide =
    ask.category !== "general"
      ? "owner or administrator"
      : addressee
        ? "the person it is addressed to"
        : "any person in the conversation";
  const decideBy = decideByText(ask.decideBy);
  // One tap works for a plain approval; every other kind of ask (money, hires,
  // tools, secrets, duties, questions, choices) has more to it, so it opens
  // the full decision.
  const quickDecision =
    ask.type === "approval" && ask.category === "general" && addressedToMe;

  React.useEffect(() => {
    if (pending) reasonInputRef.current?.focus();
  }, [pending]);

  async function submit() {
    if (!pending || submitting) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Add a short reason so the team can see why.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = {
        schemaVersion: 1,
        askId: ask.askId,
        expectedHeadEventId: record.event.id,
        outcome: pending satisfies AskOutcome,
        reason: trimmed,
      };
      const signed = await signRelayEvent({
        kind: KIND_ASK_RESPONSE,
        content: JSON.stringify(response),
        tags: [
          ["h", record.channelId],
          ["d", `channel:${record.channelId}:ask:${ask.askId}`],
        ],
      });
      await relayClient.publishEvent(
        signed,
        "The ask response timed out before the relay confirmed it.",
        "The ask response could not be sent.",
      );
      setPending(null);
      setReason("");
      await queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("company-ask"),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The response was not recorded. You can try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="ca-decision"
      data-testid={`home-inbox-decision-${ask.askId}`}
    >
      <div className="ca-decision-chips">
        {addressedToMe ? (
          <span className="ca-chip-static" data-tone="need">
            Needs you
          </span>
        ) : null}
        <span className="ca-chip-static">{needsMeAskLabel(ask)}</span>
        {decideBy ? <span className="ca-decision-by">{decideBy}</span> : null}
      </div>
      <strong className="ca-decision-title">{ask.title}</strong>
      <span className="ca-decision-who">
        Addressed to {addresseeLabel} · Can decide: {canDecide}
      </span>
      {pending ? (
        <form
          className="ca-decision-reason"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`decision-reason-${ask.askId}`}>
            {pending === "approved"
              ? "Why are you approving this?"
              : "What should change?"}
          </label>
          <input
            id={`decision-reason-${ask.askId}`}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            ref={reasonInputRef}
            value={reason}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="ca-decision-actions">
            <button
              className="ca-primary-button"
              data-testid="home-inbox-decision-confirm"
              disabled={submitting}
              type="submit"
            >
              {pending === "approved" ? "Approve" : "Request revision"}
            </button>
            <button
              className="ca-outline-button"
              disabled={submitting}
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="ca-decision-actions">
          {quickDecision ? (
            <>
              <button
                className="ca-primary-button"
                onClick={() => setPending("approved")}
                type="button"
              >
                Approve
              </button>
              <button
                className="ca-outline-button"
                onClick={() => setPending("revision_requested")}
                type="button"
              >
                Request revision
              </button>
            </>
          ) : null}
          <button
            className="ca-link-button"
            data-testid="home-inbox-decision-open"
            onClick={() =>
              void goAskDetail(
                record.channelId,
                ask.askId,
                ask.type === "tool_consent",
              )
            }
            type="button"
          >
            Open decision
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Open asks raised in the selected thread, as decision cards under its
 * messages. A plain approval can be answered here; anything else opens the
 * full decision.
 */
export function InboxDecisionCards({
  channelId,
  currentPubkey,
  messageIds,
  profiles,
}: {
  channelId: string | null;
  currentPubkey?: string;
  messageIds: ReadonlySet<string>;
  profiles?: UserProfileLookup;
}) {
  const channelIds = React.useMemo(
    () => (channelId ? [channelId] : []),
    [channelId],
  );
  const { query: asks } = useAskHeadsQuery(channelIds);
  const records = (asks.data ?? []).filter(
    (record) =>
      record.head.status === "open" &&
      messageIds.has(record.head.ask.threadRootEventId),
  );
  if (records.length === 0) return null;
  return (
    <div className="ca-decisions" data-testid="home-inbox-decisions">
      {records.map((record) => (
        <DecisionCard
          currentPubkey={currentPubkey}
          key={`${record.channelId}:${record.head.askId}`}
          profiles={profiles}
          record={record}
        />
      ))}
    </div>
  );
}
