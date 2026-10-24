import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";

import { leadInitial, type LeadSummary } from "./leadReferenceModel";
import { useLeadReference } from "./useLeadHead";

import "./colony3-lead-reference.css";

export function LeadStagePill({
  label,
  tone,
}: {
  label: string;
  tone: LeadSummary["stageTone"];
}) {
  return (
    <span className="c3r-pill" data-tone={tone}>
      {label}
    </span>
  );
}

function LeadReferenceFrame({
  children,
  leadId,
  state,
}: {
  children: React.ReactNode;
  leadId: string;
  state: "loading" | "missing" | "no-access" | "error";
}) {
  return (
    // A span, not a div: a lead link sits inside a markdown paragraph.
    <span
      className="c3r-card"
      data-state={state}
      data-testid={`lead-reference-unavailable-${leadId}`}
    >
      {children}
    </span>
  );
}

function LeadReferenceBody({ lead }: { lead: LeadSummary }) {
  return (
    <>
      <span aria-hidden="true" className="c3r-mark">
        {leadInitial(lead.name)}
      </span>
      <span className="c3r-copy">
        <span className="c3r-name">{lead.name}</span>
        {lead.meta ? <span className="c3r-meta">{lead.meta}</span> : null}
      </span>
      {lead.fitScore !== null ? (
        <span className="c3r-fit">fit {lead.fitScore}</span>
      ) : null}
      <LeadStagePill label={lead.stageLabel} tone={lead.stageTone} />
    </>
  );
}

/**
 * The card a message shows for a `buzz://lead/<id>` link. It reads one lead
 * head through a cached query (no live subscription), so a channel full of
 * references stays cheap. Non-interactive callers (quoted or previewed
 * messages) get the same card as plain text, not a button.
 */
export const LeadReferenceCard = React.memo(function LeadReferenceCard({
  leadId,
  interactive = true,
}: {
  leadId: string;
  interactive?: boolean;
}) {
  const { view, retry } = useLeadReference(leadId);
  const { goLead } = useAppNavigation();

  if (view.kind === "loading") {
    return (
      <LeadReferenceFrame leadId={leadId} state="loading">
        <span aria-hidden="true" className="c3r-mark c3r-skeleton" />
        <span className="c3r-note" role="status">
          Loading lead
        </span>
      </LeadReferenceFrame>
    );
  }

  if (view.kind === "missing") {
    return (
      <LeadReferenceFrame leadId={leadId} state="missing">
        <span aria-hidden="true" className="c3r-mark">
          ?
        </span>
        <span className="c3r-note">This lead is no longer available</span>
      </LeadReferenceFrame>
    );
  }

  if (view.kind === "no-access") {
    return (
      <LeadReferenceFrame leadId={leadId} state="no-access">
        <span aria-hidden="true" className="c3r-mark">
          ?
        </span>
        <span className="c3r-note">You do not have access to this lead</span>
      </LeadReferenceFrame>
    );
  }

  if (view.kind === "error") {
    return (
      <LeadReferenceFrame leadId={leadId} state="error">
        <span aria-hidden="true" className="c3r-mark">
          ?
        </span>
        <span className="c3r-note">This lead could not be loaded</span>
        {interactive ? (
          <button className="c3r-retry" onClick={retry} type="button">
            Try again
          </button>
        ) : null}
      </LeadReferenceFrame>
    );
  }

  const { lead } = view;
  if (!interactive) {
    return (
      <span
        className="c3r-card"
        data-state="ready"
        data-testid={`lead-reference-card-${lead.leadId}`}
      >
        <LeadReferenceBody lead={lead} />
      </span>
    );
  }

  return (
    <button
      aria-label={`Open lead: ${lead.name}`}
      className="c3r-card"
      data-state="ready"
      data-testid={`lead-reference-card-${lead.leadId}`}
      onClick={() => void goLead(lead.leadId)}
      type="button"
    >
      <LeadReferenceBody lead={lead} />
    </button>
  );
});
