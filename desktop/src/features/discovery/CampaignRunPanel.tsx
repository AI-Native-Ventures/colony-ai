import { Pause, Play, RotateCcw } from "lucide-react";

import { RUN_LABELS, formatBudget, runDescription } from "./CampaignHelpers";
import {
  CheckGlyph,
  CloseGlyph,
  MessageGlyph,
  NoticeGlyph,
  PinGlyph,
  PlusGlyph,
  SearchGlyph,
} from "./DiscoveryIcons";
import { RunnerAvatar } from "./DiscoveryRunner";
import type { DiscoveryCampaign } from "./discoveryProvider";

import "./colony3-discovery.css";

export type RunAction = "pause" | "resume" | "cancel" | "retry";

function RunIcon({ status }: { status: DiscoveryCampaign["status"] }) {
  if (status === "complete") return <CheckGlyph size={22} strokeWidth={2.6} />;
  if (status === "running") return <SearchGlyph size={22} />;
  if (status === "failed") return <NoticeGlyph size={22} strokeWidth={2.4} />;
  return <Pause aria-hidden size="1.375rem" strokeWidth={2.4} />;
}

/** The campaign's title, its three views, and the search progress panel. */
export function CampaignRunPanel({
  campaign,
  onChangeRun,
  onDiscuss,
  onNewSearch,
  onOpenDetails,
  onOpenSettings,
}: {
  campaign: DiscoveryCampaign;
  onChangeRun: (action: RunAction) => void;
  onDiscuss: () => void;
  onNewSearch: () => void;
  onOpenDetails: () => void;
  onOpenSettings: () => void;
}) {
  const progress = Math.min(
    100,
    campaign.target > 0 ? (campaign.count / campaign.target) * 100 : 0,
  );
  return (
    <>
      <div className="c3d-head">
        <div className="c3d-head-copy">
          <h1>{campaign.name}</h1>
          <p>
            {campaign.verticalName} · {campaign.location}
          </p>
        </div>
        <button
          className="c3d-btn c3d-btn--outline c3d-btn--lg"
          onClick={onDiscuss}
          type="button"
        >
          <MessageGlyph />
          Discuss in Sales
        </button>
      </div>
      <nav aria-label="Campaign views" className="c3d-tabs">
        <a aria-current="page" className="c3d-tab" href="#/campaign">
          Prospects <span className="c3d-tab-count">{campaign.count}</span>
        </a>
        <button className="c3d-tab" onClick={onOpenSettings} type="button">
          Search &amp; budget
        </button>
        <button className="c3d-tab" onClick={onDiscuss} type="button">
          Conversation <span aria-hidden="true">→</span>
        </button>
      </nav>
      <section
        aria-labelledby="run-title"
        className={`c3d-run${campaign.status === "failed" ? " is-failed" : ""}`}
      >
        <div className="c3d-run-top">
          <span
            aria-hidden="true"
            className={`c3d-run-icon c3d-run-icon--${campaign.status}`}
          >
            <RunIcon status={campaign.status} />
          </span>
          <div className="c3d-run-copy">
            <h2 id="run-title">{RUN_LABELS[campaign.status]}</h2>
            <span>{runDescription(campaign)}</span>
          </div>
          {campaign.runBy ? (
            <span className="c3d-run-by">
              <RunnerAvatar runner={campaign.runBy} size={26} />
              Run by {campaign.runBy.name}
            </span>
          ) : null}
          <div className="c3d-run-actions">
            {campaign.status === "running" ? (
              <>
                <button
                  className="c3d-btn c3d-btn--outline c3d-btn--md"
                  onClick={() => onChangeRun("pause")}
                  type="button"
                >
                  <Pause aria-hidden size="0.9375rem" strokeWidth={2.6} /> Pause
                </button>
                <button
                  aria-label="Cancel search"
                  className="c3d-btn c3d-btn--quiet c3d-btn--md"
                  onClick={() => onChangeRun("cancel")}
                  type="button"
                >
                  <CloseGlyph />
                </button>
              </>
            ) : campaign.status === "paused" ? (
              <button
                className="c3d-btn c3d-btn--ink c3d-btn--md"
                onClick={() => onChangeRun("resume")}
                type="button"
              >
                <Play aria-hidden size="0.9375rem" strokeWidth={2.6} /> Resume
              </button>
            ) : campaign.status === "failed" ? (
              <button
                className="c3d-btn c3d-btn--ink c3d-btn--md"
                onClick={() => onChangeRun("retry")}
                type="button"
              >
                <RotateCcw aria-hidden size="0.9375rem" strokeWidth={2.6} />{" "}
                Retry search
              </button>
            ) : (
              <button
                className="c3d-btn c3d-btn--ink c3d-btn--md"
                onClick={onNewSearch}
                type="button"
              >
                <PlusGlyph /> New search
              </button>
            )}
          </div>
        </div>
        <div
          aria-label="Prospects found"
          aria-valuemax={campaign.target}
          aria-valuemin={0}
          aria-valuenow={Math.min(campaign.count, campaign.target)}
          className="c3d-progress"
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="c3d-run-meta">
          <span>
            <PinGlyph /> {campaign.location}
          </span>
          <span>{campaign.count} prospects</span>
          <span>Budget approved · {formatBudget(campaign.budgetUsd)}</span>
          <button
            className="c3d-text-link"
            onClick={onOpenDetails}
            type="button"
          >
            Run details
          </button>
        </div>
      </section>
    </>
  );
}
