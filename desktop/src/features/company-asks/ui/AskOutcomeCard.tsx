import type * as React from "react";

import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { AskHead } from "../askRecords";
import {
  CannotRespond,
  ChecklistTick,
  DecisionAvatar,
  OutcomeChipView,
} from "./AskDecisionParts";
import { formatDecisionStamp, formatDeadline } from "./askCardFormatting";
import { cardEyebrow, describeOutcome } from "./askOutcomeModel";
import type { OutcomeChip } from "./askOutcomeModel";
import "./askDecisions.css";

export type OutcomeActorView = {
  pubkey: string;
  name: string;
  isAgent?: boolean;
};

/**
 * What a decided ask shows: who decided and when, the reason as a quote, the
 * options of a choice or the items of a checklist. Used under the card chrome
 * on the thread cards and inside the decision pages.
 */
export function OutcomeBody({
  head,
  resolver,
  canceller,
  profiles,
  now,
}: {
  head: AskHead;
  resolver: OutcomeActorView | null;
  canceller: OutcomeActorView | null;
  profiles?: UserProfileLookup;
  now?: Date;
}) {
  if (head.status === "cancelled" && head.cancellation) {
    const stamp = formatDecisionStamp(head.cancellation.cancelledAt, now);
    return (
      <div className="colony-outcome-body" data-testid="ask-cancelled">
        {canceller ? (
          <p className="colony-outcome-by">
            <DecisionAvatar
              isAgent={canceller.isAgent}
              name={canceller.name}
              profiles={profiles}
              pubkey={canceller.pubkey}
              size={22}
            />
            {`Cancelled by ${canceller.name}${stamp ? ` · ${stamp}` : ""}`}
          </p>
        ) : null}
        <p className="colony-outcome-quote">{`“${head.cancellation.reason}”`}</p>
      </div>
    );
  }
  const content = describeOutcome(head);
  if (!content || !head.resolution) return null;
  const stamp = formatDecisionStamp(head.resolution.resolvedAt, now);
  return (
    <div className="colony-outcome-body" data-testid="ask-resolved">
      {content.verb && resolver ? (
        <p className="colony-outcome-by">
          <DecisionAvatar
            isAgent={resolver.isAgent}
            name={resolver.name}
            profiles={profiles}
            pubkey={resolver.pubkey}
            size={22}
          />
          {`${content.verb} by ${resolver.name}${stamp ? ` · ${stamp}` : ""}`}
        </p>
      ) : null}
      {content.quote ? (
        <p className="colony-outcome-quote">{`“${content.quote}”`}</p>
      ) : null}
      {content.options ? (
        <ul aria-label="Choices" className="colony-outcome-choices">
          {content.options.map((option) => (
            <li data-chosen={option.chosen} key={option.id}>
              {option.chosen ? <ChecklistTickSmall /> : null}
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
      {content.items ? (
        <>
          <ul aria-label="Checklist" className="colony-outcome-items">
            {content.items.map((item) => (
              <li key={item.id}>
                <ChecklistTick />
                {item.label}
              </li>
            ))}
          </ul>
          {resolver ? (
            <p className="colony-outcome-by" data-muted="true">
              <DecisionAvatar
                isAgent={resolver.isAgent}
                name={resolver.name}
                profiles={profiles}
                pubkey={resolver.pubkey}
                size={22}
              />
              {`All checklist items confirmed by ${resolver.name}`}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ChecklistTickSmall() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="0.75rem"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3.2}
      viewBox="0 0 24 24"
      width="0.75rem"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

/**
 * The compact ask card of `AskOutcomes.dc.html`: the kind of ask in small
 * caps, its state as a chip, the title, then whatever the state calls for.
 */
export function AskOutcomeCard({
  askId,
  variant,
  head,
  chip,
  title,
  titleLink,
  warn = false,
  children,
}: {
  askId: string;
  variant?: string;
  head: AskHead;
  chip: OutcomeChip;
  title: string;
  /** Wraps the title in a link to the decision page. */
  titleLink?: (title: string) => React.ReactNode;
  /** The amber ring of an ask that is overdue and still open. */
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${cardEyebrow(head.ask)} ask`}
      className="colony-outcome-card"
      data-ask-id={askId}
      data-ask-variant={variant}
      data-testid="ask-card"
      data-tone={warn ? "need" : undefined}
    >
      <div className="colony-outcome-head">
        <span className="colony-outcome-eyebrow">{cardEyebrow(head.ask)}</span>
        <OutcomeChipView chip={chip} testId="ask-status" />
      </div>
      <h2 className="colony-outcome-title">
        {titleLink ? titleLink(title) : title}
      </h2>
      {children}
    </section>
  );
}

/**
 * An ask in a thread, in every state but "open and the viewer can answer it
 * inline": decided and cancelled asks show their outcome, open budget and tool
 * asks show who raised them and open the decision page.
 */
export function AskThreadOutcomeCard({
  askId,
  head,
  kind,
  asker,
  isOverdue,
  canAnswer,
  accessFailure,
  deniedMessage,
  liveUnavailable,
  profiles,
  resolver,
  canceller,
  detailLink,
  conversationLink,
  titleLink,
  now,
}: {
  askId: string;
  head: AskHead;
  kind?: string;
  asker: OutcomeActorView;
  isOverdue: boolean;
  canAnswer: boolean;
  accessFailure: boolean;
  deniedMessage: string;
  liveUnavailable: boolean;
  profiles?: UserProfileLookup;
  resolver: OutcomeActorView | null;
  canceller: OutcomeActorView | null;
  /** The "Open decision" button. */
  detailLink: React.ReactNode;
  /** The "Open conversation" link. */
  conversationLink: React.ReactNode;
  /** Wraps the title of a decided card in a link to the decision page. */
  titleLink: (title: string) => React.ReactNode;
  now?: Date;
}) {
  const open = head.status === "open";
  const content = describeOutcome(head);
  const chip: OutcomeChip = isOverdue
    ? { label: "Overdue · still open", tone: "need", icon: "alert" }
    : (content?.chip ?? {
        label: open
          ? "Open"
          : head.status.charAt(0).toUpperCase() + head.status.slice(1),
        tone: "idle",
        icon: null,
      });
  const decideBy = formatDeadline(head.ask.decideBy, {
    lowercaseDay: true,
    now,
  });
  return (
    <AskOutcomeCard
      askId={askId}
      chip={chip}
      head={head}
      title={head.ask.title}
      titleLink={open ? undefined : titleLink}
      variant={kind}
      warn={isOverdue}
    >
      {open ? (
        canAnswer ? (
          <>
            <p className="colony-outcome-by">
              <DecisionAvatar
                isAgent={asker.isAgent}
                name={asker.name}
                profiles={profiles}
                pubkey={asker.pubkey}
                size={24}
              />
              {`Raised by ${asker.name}${decideBy ? ` · Decide by ${decideBy}` : ""}`}
            </p>
            {detailLink}
          </>
        ) : (
          <>
            <CannotRespond alert={accessFailure} message={deniedMessage} />
            {conversationLink}
          </>
        )
      ) : (
        <OutcomeBody
          canceller={canceller}
          head={head}
          now={now}
          profiles={profiles}
          resolver={resolver}
        />
      )}
      {liveUnavailable && open ? (
        <p className="colony-outcome-live" role="status">
          Live updates are unavailable. The ask will refresh when the relay
          reconnects.
        </p>
      ) : null}
    </AskOutcomeCard>
  );
}
