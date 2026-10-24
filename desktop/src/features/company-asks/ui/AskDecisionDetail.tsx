import type * as React from "react";
import { Link } from "@tanstack/react-router";

import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { AskHeadRecord } from "../askRecords";
import { AskResponseForm } from "./AskResponseForm";
import {
  CannotRespond,
  DecisionAvatar,
  DecisionChip,
  DecisionContext,
  ShieldGlyph,
} from "./AskDecisionParts";
import type { LinkedWorkView } from "./AskDecisionParts";
import { OutcomeBody } from "./AskOutcomeCard";
import type { OutcomeActorView } from "./AskOutcomeCard";
import type { OutcomeChip } from "./askOutcomeModel";
import "./askDecisions.css";

export type DecisionDetailModel = {
  /** The Decision page (general ask) or the Funding decision page. */
  variant: "general" | "funding";
  record: AskHeadRecord;
  /** "Approval", "Question"... */
  typeText: string;
  specializedKind?: string;
  asker: OutcomeActorView;
  /** The time the ask was raised, as a clock time. */
  raisedClock: string | null;
  channelName: string;
  needsYou: boolean;
  statusChip: OutcomeChip;
  /** "Decision requested", "Decision recorded" or "Decision withdrawn". */
  decisionHeading: string;
  addressee: { pubkey: string; name: string } | null;
  /** "today, 14:00", for "Decide by ...". */
  deadlineSentence: string | null;
  /** "Today, 14:00", for the context panel. */
  deadlineLabel: string | null;
  overdue: boolean;
  linkedWork: LinkedWorkView | null;
  /** Employee, requested allowance, duration and end date of a funding ask. */
  tiles: Array<{ label: string; value: string }> | null;
  toolPreview: string | null;
  canRespond: boolean;
  deniedMessage: string;
  accessFailure: boolean;
  resolver: OutcomeActorView | null;
  canceller: OutcomeActorView | null;
  profiles?: UserProfileLookup;
  liveUnavailable: boolean;
  /** Where "Back to discussion" goes; null hides the link. */
  discussion: { channelId: string; rootId: string } | null;
  /** The spending notice above the buttons. */
  notice: React.ReactNode;
  /** The message the page shows above the card (the Decision page). */
  leading?: React.ReactNode;
};

function DiscussionLink({
  discussion,
  label,
}: {
  discussion: { channelId: string; rootId: string };
  label: string;
}) {
  return (
    <Link
      className="colony-decision-link"
      params={{ channelId: discussion.channelId }}
      search={{
        messageId: discussion.rootId,
        threadRootId: discussion.rootId,
        thread: discussion.rootId,
      }}
      to="/channels/$channelId"
    >
      {label}
    </Link>
  );
}

/**
 * The two decision pages of Colony 3.0: the Decision page for a general ask
 * (`AskDetail.dc.html`) and the Funding decision page for an allowance or tool
 * ask (`AskMoneyDetail.dc.html`), each with its Decision context panel.
 */
export function AskDecisionDetail({ model }: { model: DecisionDetailModel }) {
  const { record } = model;
  const head = record.head;
  const ask = head.ask;
  const funding = model.variant === "funding";
  const open = head.status === "open";
  const links = (
    <>
      {model.discussion ? (
        <DiscussionLink
          discussion={model.discussion}
          label={funding && !open ? "Open conversation" : "Back to discussion"}
        />
      ) : null}
      {funding && !open ? null : (
        <Link className="colony-decision-link" to="/today">
          Needs me
        </Link>
      )}
    </>
  );

  const chips = funding ? (
    <div className="colony-decision-chips">
      <h2>{model.decisionHeading}</h2>
      {model.needsYou ? (
        <DecisionChip testId="ask-needs-you" tone="need">
          Needs you
        </DecisionChip>
      ) : null}
      <DecisionChip testId="ask-status" tone={chipTone(model.statusChip)}>
        {model.statusChip.label}
      </DecisionChip>
    </div>
  ) : (
    <div className="colony-decision-chips">
      <DecisionChip testId="ask-status" tone={chipTone(model.statusChip)}>
        {model.statusChip.label}
      </DecisionChip>
      {model.needsYou ? (
        <DecisionChip testId="ask-needs-you" tone="need">
          Needs you
        </DecisionChip>
      ) : null}
      <span className="colony-decision-meta">
        {model.typeText}
        {model.deadlineSentence ? ` · Decide by ${model.deadlineSentence}` : ""}
      </span>
    </div>
  );

  const state = open ? (
    model.canRespond ? (
      <AskResponseForm
        actions={links}
        layout="decision"
        notice={
          model.notice ? (
            <>
              <ShieldGlyph />
              {model.notice}
            </>
          ) : null
        }
        record={record}
      />
    ) : (
      <>
        <CannotRespond
          alert={model.accessFailure}
          message={model.deniedMessage}
        />
        <div className="colony-decision-actions" data-passive="true">
          {links}
        </div>
      </>
    )
  ) : (
    <>
      <OutcomeBody
        canceller={model.canceller}
        head={head}
        profiles={model.profiles}
        resolver={model.resolver}
      />
      <div className="colony-decision-actions" data-passive="true">
        {links}
      </div>
    </>
  );

  const card = (
    <div className="colony-decision-card" data-variant={model.variant}>
      {chips}
      {funding ? (
        <div className="colony-decision-message">
          <DecisionAvatar
            isAgent={model.asker.isAgent}
            name={model.asker.name}
            profiles={model.profiles}
            pubkey={model.asker.pubkey}
            size={42}
          />
          <div className="colony-decision-message-body">
            <div className="colony-decision-message-head">
              <strong>{model.asker.name}</strong>
              <span>
                {model.asker.isAgent ? "AI employee" : "Person"} · #
                {model.channelName}
                {model.raisedClock ? ` · ${model.raisedClock}` : ""}
              </span>
            </div>
            {ask.body ? (
              <p className="colony-decision-message-text">{ask.body}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="colony-decision-heading">
          <h2>{ask.title}</h2>
          {ask.body ? <p>{ask.body}</p> : null}
          {model.addressee ? (
            <span className="colony-decision-addressed">
              Addressed to <strong>{model.addressee.name}</strong>
            </span>
          ) : null}
        </div>
      )}
      {model.tiles ? (
        <dl
          className="colony-decision-tiles"
          data-testid="ask-money-allowance-proposal"
        >
          {model.tiles.map((tile) => (
            <div key={tile.label}>
              <dt>{tile.label}</dt>
              <dd>{tile.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {model.toolPreview ? (
        <p
          className="colony-decision-preview"
          data-testid="tool-consent-preview"
        >
          {model.toolPreview}
        </p>
      ) : null}
      {state}
      {model.liveUnavailable && open ? (
        <p className="colony-outcome-live" role="status">
          Live updates are unavailable. The ask will refresh when the relay
          reconnects.
        </p>
      ) : null}
    </div>
  );

  return (
    <section
      aria-label={`${model.typeText} ask`}
      className="colony-decision-layout"
      data-ask-id={ask.askId}
      data-ask-variant={model.specializedKind}
      data-testid="ask-card"
    >
      {funding ? (
        card
      ) : (
        <div className="colony-decision-main">
          {model.leading}
          {card}
        </div>
      )}
      <DecisionContext
        addresseeName={model.addressee?.name ?? null}
        addresseePubkey={model.addressee?.pubkey ?? null}
        deadline={model.deadlineLabel}
        funding={funding}
        linkedWork={model.linkedWork}
        overdue={model.overdue}
        profiles={model.profiles}
      />
    </section>
  );
}

function chipTone(chip: OutcomeChip): "idle" | "need" | "bad" | "ok" | "info" {
  return chip.tone;
}
