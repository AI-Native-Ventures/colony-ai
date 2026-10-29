import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { campaignStatusLabel } from "./CampaignHelpers";
import {
  ArrowRightGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  PlusGlyph,
} from "./DiscoveryIcons";
import { RunnerAvatar } from "./DiscoveryRunner";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryRunner,
} from "./discoveryProvider";

import "./colony3-discovery.css";

export type PendingCampaign = Pick<
  DiscoveryCampaignInput,
  | "audience"
  | "industryId"
  | "industryName"
  | "verticalId"
  | "verticalName"
  | "pickedTags"
>;

export type CampaignFormInput = {
  name: string;
  location: string;
  target: number;
  criteria: string;
};

const BUDGET_PER_PROSPECT_USD = 0.05;

function startFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The campaign could not be started. Retry when the connection is available.";
}

/** "Find the right fit." (`DiscoveryCampaignModal`, the form). */
export function DiscoveryCampaignDialog({
  onOpenChange,
  onSubmit,
  open,
  pending,
  runner,
  simulatedCosts,
  initialLocation,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CampaignFormInput) => Promise<void>;
  open: boolean;
  pending: PendingCampaign | null;
  /** Who will run the search; the line is left out when unknown. */
  runner: DiscoveryRunner | null;
  /** The test-build stand-in keeps the design's example wording. */
  simulatedCosts: boolean;
  initialLocation?: string;
}) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("Johannesburg");
  const [target, setTarget] = React.useState("50");
  const [criteria, setCriteria] = React.useState("");
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const budget = Math.max(0, Number(target) || 0) * BUDGET_PER_PROSPECT_USD;

  React.useEffect(() => {
    if (!open || !pending) return;
    setName(`${pending.verticalName} prospects`);
    setLocation(initialLocation?.trim() || "Johannesburg");
    setTarget("50");
    setCriteria("");
    setApproved(false);
    setError("");
  }, [initialLocation, open, pending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requested = Number(target);
    if (
      !location.trim() ||
      !Number.isInteger(requested) ||
      requested < 1 ||
      requested > 500 ||
      !approved
    ) {
      setError(
        "Add a location, choose 1–500 prospects and approve the maximum budget.",
      );
      return;
    }
    if (!name.trim()) {
      setError("Add a campaign name.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        location: location.trim(),
        target: requested,
        criteria,
      });
    } catch (startError) {
      setError(startFailureMessage(startError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3d-dialog c3d-dialog--form"
        data-testid="discovery-campaign-dialog"
        showCloseButton={false}
      >
        <div className="c3d-dialog-head">
          <p className="c3d-eyebrow">New discovery campaign</p>
          <DialogTitle className="c3d-dialog-title">
            Find the right fit.
          </DialogTitle>
          <DialogDescription className="c3d-dialog-sub">
            {pending
              ? `${pending.industryName} / ${pending.verticalName}`
              : "Choose a category."}
          </DialogDescription>
        </div>
        <form
          className="contents"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <div className="c3d-field">
            <label htmlFor="w10-campaign-name">Campaign name</label>
            <input
              id="w10-campaign-name"
              onChange={(event) => setName(event.currentTarget.value)}
              required
              value={name}
            />
          </div>
          <div className="c3d-field-row">
            <div className="c3d-field">
              <label htmlFor="w10-campaign-location">Location</label>
              <input
                id="w10-campaign-location"
                onChange={(event) => setLocation(event.currentTarget.value)}
                placeholder="City, region or country"
                required
                value={location}
              />
            </div>
            <div className="c3d-field">
              <label htmlFor="w10-campaign-target">Prospect target</label>
              <input
                id="w10-campaign-target"
                max={500}
                min={1}
                onChange={(event) => setTarget(event.currentTarget.value)}
                required
                type="number"
                value={target}
              />
            </div>
          </div>
          <div className="c3d-field">
            <label htmlFor="w10-campaign-criteria">
              What makes a good fit? <span>Optional</span>
            </label>
            <textarea
              id="w10-campaign-criteria"
              onChange={(event) => setCriteria(event.currentTarget.value)}
              placeholder="For example, independent stores that carry locally made products…"
              rows={3}
              value={criteria}
            />
          </div>
          <div className="c3d-budget">
            <span>
              <strong>Maximum search budget</strong>
              <small>
                {simulatedCosts
                  ? "Example pricing · Actual results and costs are simulated."
                  : "Colony covers the search cost for now."}
              </small>
            </span>
            <span className="c3d-budget-amount">${budget.toFixed(2)}</span>
          </div>
          {runner ? (
            <div className="c3d-runner-line">
              <RunnerAvatar runner={runner} size={28} />
              <span>
                {runner.name} runs the search in the background and reports back
                in #Sales.
              </span>
            </div>
          ) : null}
          <label className="c3d-approval">
            <input
              checked={approved}
              onChange={(event) => setApproved(event.currentTarget.checked)}
              type="checkbox"
            />
            I approve this campaign’s maximum budget.
          </label>
          {error ? (
            <p className="c3d-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="c3d-dialog-actions c3d-form-actions">
            <button
              className="c3d-btn c3d-btn--outline c3d-btn--lg c3d-btn--px20"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3d-btn c3d-btn--ink c3d-btn--lg c3d-btn--px22"
              disabled={submitting || !pending}
              type="submit"
            >
              Approve &amp; start <ArrowRightGlyph size={16} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Your discovery campaigns." (`DiscoveryCampaignModal`, the list). */
export function DiscoveryCampaignListDialog({
  campaigns,
  onOpenChange,
  onSelect,
  onStartNew,
  open,
}: {
  campaigns: DiscoveryCampaign[];
  onOpenChange: (open: boolean) => void;
  onSelect: (campaignId: string) => void;
  onStartNew: () => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3d-dialog c3d-dialog--list"
        data-testid="discovery-campaign-list-dialog"
        showCloseButton={false}
      >
        <div className="c3d-dialog-head-row">
          <DialogTitle className="c3d-dialog-title c3d-dialog-title--md">
            Your discovery campaigns.
          </DialogTitle>
          <DialogClose asChild>
            <button aria-label="Close" className="c3d-close" type="button">
              <CloseGlyph />
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          Choose a campaign to review.
        </DialogDescription>
        <div className="c3d-campaign-list">
          {campaigns.map((campaign) => (
            <button
              className="c3d-campaign-row"
              key={campaign.id}
              onClick={() => onSelect(campaign.id)}
              type="button"
            >
              {campaign.runBy ? (
                <RunnerAvatar runner={campaign.runBy} size={36} />
              ) : (
                <span aria-hidden="true" className="c3d-avatar c3d-initial">
                  {campaign.name.slice(0, 1).toLocaleUpperCase()}
                </span>
              )}
              <span className="c3d-campaign-row-copy">
                <strong>{campaign.name}</strong>
                <span>
                  {campaign.location} · {campaign.count} prospects ·{" "}
                  {campaignStatusLabel(campaign.status)}
                </span>
              </span>
              <ChevronRightGlyph />
            </button>
          ))}
        </div>
        <button
          className="c3d-btn c3d-btn--track c3d-start-new"
          disabled={!campaigns.length}
          onClick={onStartNew}
          type="button"
        >
          Start a new campaign <PlusGlyph />
        </button>
      </DialogContent>
    </Dialog>
  );
}
