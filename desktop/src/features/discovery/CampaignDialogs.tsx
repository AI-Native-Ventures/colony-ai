import { Clock3 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { RUN_LABELS, formatBudget } from "./CampaignHelpers";
import {
  CheckGlyph,
  CloseGlyph,
  InfoGlyph,
  NoticeGlyph,
} from "./DiscoveryIcons";
import { RunnerAvatar } from "./DiscoveryRunner";
import type { DiscoveryCampaign } from "./discoveryProvider";

import "./colony3-discovery.css";

export type CampaignDialogMode = "details" | "settings" | null;

const INTERRUPTED_STEP = "A search source stopped responding";
const DESIGN_CRITERIA = "Independent stores with a local-maker focus.";

type StepState = "done" | "final" | "bad" | "wait";

function StepMark({ state }: { state: StepState }) {
  if (state === "bad") {
    return (
      <span aria-hidden="true" className="c3d-step-mark c3d-step-mark--bad">
        <NoticeGlyph size={14} strokeWidth={3} />
      </span>
    );
  }
  if (state === "wait") {
    return (
      <span aria-hidden="true" className="c3d-step-mark c3d-step-mark--wait">
        <Clock3 aria-hidden size="0.875rem" strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`c3d-step-mark${state === "final" ? " c3d-step-mark--done" : ""}`}
    >
      <CheckGlyph size={14} strokeWidth={3} />
    </span>
  );
}

function runSteps(campaign: DiscoveryCampaign): Array<{
  text: string;
  state: StepState;
}> {
  const failed = campaign.status === "failed";
  const duplicates = campaign.skippedDuplicates ?? 0;
  const duplicateText = duplicates
    ? `Duplicate check and source references retained · ${duplicates} already in Leads`
    : "Duplicate check and source references retained";
  return [
    { text: "Search criteria prepared", state: "done" },
    { text: `${campaign.count} public profiles found`, state: "done" },
    failed
      ? {
          text: campaign.failureReason?.trim() || INTERRUPTED_STEP,
          state: "bad",
        }
      : { text: duplicateText, state: "done" },
    {
      text: RUN_LABELS[campaign.status],
      state: campaign.status === "complete" ? "final" : "wait",
    },
  ];
}

/** "Search activity." and "Search & budget." (`CampaignModals`). */
export function CampaignDialog({
  campaign,
  mode,
  onClose,
  onCreateSearch,
  onPreviewFailure,
}: {
  campaign: DiscoveryCampaign;
  mode: CampaignDialogMode;
  onClose: () => void;
  onCreateSearch: () => void;
  /** Only the test-build stand-in offers this; it is test scaffolding. */
  onPreviewFailure: (() => void) | null;
}) {
  const runBy = campaign.runBy ?? null;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={mode !== null}
    >
      <DialogContent
        className="c3d-dialog c3d-dialog--run"
        data-testid={
          mode === "settings"
            ? "campaign-budget-dialog"
            : "campaign-activity-dialog"
        }
        showCloseButton={false}
      >
        {mode === "details" ? (
          <>
            <div className="c3d-dialog-head-row">
              <div>
                <DialogTitle className="c3d-dialog-title c3d-dialog-title--md">
                  Search activity.
                </DialogTitle>
                <DialogDescription className="c3d-dialog-sub c3d-dialog-sub--sm">
                  {campaign.name} ·{" "}
                  {campaign.simulated ? "Example run" : campaign.location}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button aria-label="Close" className="c3d-close" type="button">
                  <CloseGlyph />
                </button>
              </DialogClose>
            </div>
            {runBy ? (
              <div className="c3d-run-line">
                <RunnerAvatar runner={runBy} size={28} />
                <span>
                  Run by {runBy.name}
                  {campaign.postedInSales ? " · results posted in #Sales" : ""}
                </span>
              </div>
            ) : null}
            <ol className="c3d-steps">
              {runSteps(campaign).map((step) => (
                <li className="c3d-step" key={step.text}>
                  <StepMark state={step.state} />
                  {step.text}
                </li>
              ))}
            </ol>
            <p className="c3d-note">
              <InfoGlyph />
              <span>
                {campaign.simulated
                  ? "This prototype simulates progress and results. It does not contact a provider or spend credits."
                  : "Results are public business listings from Google Maps. Review each one before you reach out."}
              </span>
            </p>
            <div className="c3d-dialog-actions">
              {campaign.simulated &&
              campaign.status === "running" &&
              onPreviewFailure ? (
                <button
                  className="c3d-btn c3d-btn--outline c3d-btn--lg c3d-btn--px20"
                  onClick={onPreviewFailure}
                  type="button"
                >
                  Preview a source failure
                </button>
              ) : null}
              <button
                className="c3d-btn c3d-btn--ink c3d-btn--lg c3d-btn--px24"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </div>
          </>
        ) : mode === "settings" ? (
          <>
            <div className="c3d-dialog-head-row">
              <DialogTitle className="c3d-dialog-title c3d-dialog-title--md">
                Search &amp; budget.
              </DialogTitle>
              <DialogClose asChild>
                <button aria-label="Close" className="c3d-close" type="button">
                  <CloseGlyph />
                </button>
              </DialogClose>
            </div>
            <DialogDescription className="sr-only">
              {campaign.name}
            </DialogDescription>
            <dl className="c3d-facts">
              <dt>Audience</dt>
              <dd>{campaign.verticalName}</dd>
              <dt>Location</dt>
              <dd>{campaign.location}</dd>
              <dt>Target</dt>
              <dd>{campaign.target} prospects</dd>
              <dt>Criteria</dt>
              <dd className="is-text">
                {campaign.criteria.trim() ||
                  (campaign.simulated ? DESIGN_CRITERIA : "None added")}
              </dd>
              <dt>Budget</dt>
              <dd>
                Up to {formatBudget(campaign.budgetUsd)}
                {campaign.simulated ? <span> · Example</span> : null}
              </dd>
            </dl>
            <p className="c3d-note c3d-note--amber">
              <NoticeGlyph />
              <span>
                A different audience, location or spending limit needs a new
                review before the search starts.
              </span>
            </p>
            <div className="c3d-dialog-actions">
              <button
                className="c3d-btn c3d-btn--outline c3d-btn--lg c3d-btn--px20"
                onClick={onCreateSearch}
                type="button"
              >
                Create another search
              </button>
              <button
                className="c3d-btn c3d-btn--ink c3d-btn--lg c3d-btn--px24"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
