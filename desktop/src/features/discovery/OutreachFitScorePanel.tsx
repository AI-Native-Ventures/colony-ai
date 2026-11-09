import * as React from "react";

import {
  outreachNotContactedReason,
  type OutreachFitScore,
  type OutreachFitScorePart,
  type OutreachNotContactedReason,
} from "./outreachFitScore";

/** The stored lead facts needed to render one score and contactability row. */
export type OutreachFitLead = {
  leadId: string;
  name: string;
  location: string | null;
  fit: OutreachFitScore | null;
  hasWhatsAppNumber: boolean;
};

type FitLeadRow = OutreachFitLead & {
  reason: OutreachNotContactedReason | null;
};

type FitLeadView = "all" | "will-message" | "not-contacted";

const FIT_LEAD_VIEWS: readonly FitLeadView[] = [
  "all",
  "will-message",
  "not-contacted",
];

/** Accessible shared control for the opt-in minimum outreach score. */
export function MinimumFitControl({
  minimumFit,
  onMinimumFitChange,
}: {
  minimumFit: number | null;
  onMinimumFitChange: (minimumFit: number | null) => void;
}) {
  const minimumId = React.useId();
  const enabledId = React.useId();
  const value = minimumFit ?? 60;

  return (
    <div className="c3f-minimum-control">
      <label className="c3f-minimum-toggle" htmlFor={enabledId}>
        <input
          checked={minimumFit !== null}
          id={enabledId}
          onChange={(event) =>
            onMinimumFitChange(event.currentTarget.checked ? value : null)
          }
          type="checkbox"
        />
        <span>
          <strong>Only message the best matches</strong>
          <small>Default off. Turn this on to use a minimum fit score.</small>
        </span>
      </label>
      <div className="c3f-minimum-range">
        <label htmlFor={minimumId}>Minimum fit score</label>
        <input
          disabled={minimumFit === null}
          id={minimumId}
          max={100}
          min={1}
          onChange={(event) =>
            onMinimumFitChange(Number(event.currentTarget.value))
          }
          type="range"
          value={value}
        />
        <output aria-live="polite" htmlFor={minimumId}>
          {minimumFit === null ? "Off" : `${String(value)} / 100`}
        </output>
      </div>
    </div>
  );
}

/** Leads-page score board with accessible tabs for ready and held leads. */
export function OutreachFitScoreDashboard({
  leads,
  minimumFit,
  onMinimumFitChange,
}: {
  leads: readonly OutreachFitLead[];
  minimumFit: number | null;
  onMinimumFitChange: (minimumFit: number | null) => void;
}) {
  const [view, setView] = React.useState<FitLeadView>("all");
  const panelId = React.useId();
  const moveTab = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, current: FitLeadView) => {
      const index = FIT_LEAD_VIEWS.indexOf(current);
      const nextIndex =
        event.key === "ArrowRight"
          ? (index + 1) % FIT_LEAD_VIEWS.length
          : event.key === "ArrowLeft"
            ? (index - 1 + FIT_LEAD_VIEWS.length) % FIT_LEAD_VIEWS.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? FIT_LEAD_VIEWS.length - 1
                : null;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = FIT_LEAD_VIEWS[nextIndex];
      setView(next);
      requestAnimationFrame(() => {
        document.getElementById(`${panelId}-${next}`)?.focus();
      });
    },
    [panelId],
  );
  const rows = React.useMemo<FitLeadRow[]>(
    () =>
      leads.map((lead) => ({
        ...lead,
        reason: outreachNotContactedReason({
          fit: lead.fit,
          hasWhatsAppNumber: lead.hasWhatsAppNumber,
          minimumFit,
        }),
      })),
    [leads, minimumFit],
  );
  const notContacted = rows.filter((row) => row.reason !== null);
  const willMessage = rows.filter((row) => row.reason === null);
  const unchecked = rows.filter((row) => row.fit === null);
  const visibleRows =
    view === "will-message"
      ? willMessage
      : view === "not-contacted"
        ? notContacted
        : rows;

  return (
    <section
      aria-labelledby={`${panelId}-heading`}
      className="c3f-dashboard c3l-card"
      data-testid="fit-score-dashboard"
    >
      <div className="c3f-dashboard-heading">
        <div>
          <p className="c3f-eyebrow">Outreach fit</p>
          <h2 id={`${panelId}-heading`}>Only message the best matches</h2>
          <p>
            A transparent score from stored Maps reputation and website facts,
            never an AI decision.
          </p>
        </div>
        <MinimumFitControl
          minimumFit={minimumFit}
          onMinimumFitChange={onMinimumFitChange}
        />
      </div>

      <div className="c3f-summary">
        <FitSummary label="Will message" value={willMessage.length} />
        <FitSummary label="Not contacted" value={notContacted.length} />
        <FitSummary label="Need website check" value={unchecked.length} />
      </div>

      <div
        aria-label="Outreach fit lead groups"
        className="c3f-tabs"
        role="tablist"
      >
        <FitTab
          active={view === "all"}
          id={`${panelId}-all`}
          label={`All ${String(rows.length)}`}
          onKeyDown={(event) => moveTab(event, "all")}
          onSelect={() => setView("all")}
          panelId={`${panelId}-panel`}
        />
        <FitTab
          active={view === "will-message"}
          id={`${panelId}-will-message`}
          label={`Will message ${String(willMessage.length)}`}
          onKeyDown={(event) => moveTab(event, "will-message")}
          onSelect={() => setView("will-message")}
          panelId={`${panelId}-panel`}
        />
        <FitTab
          active={view === "not-contacted"}
          id={`${panelId}-not-contacted`}
          label={`Not contacted ${String(notContacted.length)}`}
          onKeyDown={(event) => moveTab(event, "not-contacted")}
          onSelect={() => setView("not-contacted")}
          panelId={`${panelId}-panel`}
        />
      </div>

      <div
        aria-labelledby={`${panelId}-${view}`}
        className="c3f-table-wrap"
        id={`${panelId}-panel`}
        role="tabpanel"
      >
        {visibleRows.length ? (
          <table className="c3f-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Fit score</th>
                <th>Why not contacted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  data-testid={
                    row.reason ? `fit-not-contacted-${row.leadId}` : undefined
                  }
                  key={row.leadId}
                >
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.location ?? "Location not set"}</small>
                  </td>
                  <td>
                    {row.fit ? (
                      <span className="c3f-score-meter">
                        <span
                          className="c3f-score"
                          data-tone={fitScoreTone(row.fit.score)}
                        >
                          {row.fit.score}
                        </span>
                        <span aria-hidden="true" className="c3f-score-track">
                          <span
                            className="c3f-score-fill"
                            style={{ width: `${String(row.fit.score)}%` }}
                          />
                        </span>
                      </span>
                    ) : (
                      <span className="c3f-score is-pending">Not checked</span>
                    )}
                  </td>
                  <td>
                    {row.reason ? (
                      <>
                        <strong>{row.reason.label}</strong>
                        <small>{row.reason.detail}</small>
                      </>
                    ) : (
                      <span className="c3f-ready">Ready to message</span>
                    )}
                  </td>
                  <td>
                    <a href={`#/sales/lead/${row.leadId}`}>
                      {row.reason ? actionLabel(row.reason.code) : "Open lead"}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="c3f-empty" role="status">
            No leads in this group.
          </p>
        )}
      </div>
    </section>
  );
}

/** Lead-detail explanation of the stored facts behind a fit score. */
export function OutreachFitScoreBreakdown({
  fit,
  name,
}: {
  fit: OutreachFitScore | null;
  name: string;
}) {
  if (!fit) return null;

  return (
    <section
      aria-labelledby="outreach-fit-breakdown"
      className="c3f-breakdown c3l-card c3l-panel"
      data-testid="outreach-fit-breakdown"
    >
      <div className="c3f-breakdown-heading">
        <div>
          <p className="c3f-eyebrow">Transparent fit score</p>
          <h2 id="outreach-fit-breakdown">
            Why {name} scores {fit.score}
          </h2>
        </div>
        <span className="c3f-score">{fit.score}</span>
      </div>
      <p className="c3f-breakdown-copy">
        Points come from stored Maps bands and website observations. Lower
        confidence reduces a signal’s contribution.
      </p>
      {fit.parts.length ? (
        <ul className="c3f-breakdown-list">
          {fit.parts.map((part, index) => (
            <FitScorePartRow key={`${part.key}:${String(index)}`} part={part} />
          ))}
        </ul>
      ) : (
        <p className="c3f-empty">No stored facts have added points yet.</p>
      )}
    </section>
  );
}

function FitTab({
  active,
  id,
  label,
  onKeyDown,
  onSelect,
  panelId,
}: {
  active: boolean;
  id: string;
  label: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onSelect: () => void;
  panelId: string;
}) {
  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      id={id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function FitSummary({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function FitScorePartRow({ part }: { part: OutreachFitScorePart }) {
  const confidence =
    part.confidence !== undefined && part.confidence < 1
      ? `, ${String(Math.round(part.confidence * 100))}% confidence`
      : "";
  return (
    <li>
      <span>
        {part.label}
        {confidence}
      </span>
      <strong>+{part.points}</strong>
    </li>
  );
}

function actionLabel(code: OutreachNotContactedReason["code"]): string {
  switch (code) {
    case "below_minimum_fit":
      return "Review score";
    case "no_whatsapp_number":
      return "Add number";
    case "not_checked":
      return "Check website";
    default:
      return "Open lead";
  }
}

function fitScoreTone(score: number): "high" | "medium" | "low" {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}
