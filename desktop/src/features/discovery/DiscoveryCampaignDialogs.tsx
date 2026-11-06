import * as React from "react";

import {
  loadActiveCommunityId,
  loadCommunities,
} from "@/features/communities/communityStorage";
import { copyTextToSystemClipboard } from "@/shared/api/tauriMedia";
import {
  actionFailureFromError,
  logActionFailure,
  type ActionFailure,
} from "@/shared/lib/actionFailure";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { formatBudget } from "./CampaignHelpers";
import { ArrowRightGlyph } from "./DiscoveryIcons";
import { RunnerAvatar } from "./DiscoveryRunner";
import {
  attachNearbyLocations,
  readRecentDiscoveryLocations,
  rememberDiscoveryLocation,
  type DiscoveryLocation,
} from "./discoveryLocation";
import { searchDiscoveryLocations } from "./discoveryLocationClient";
import { SALES_NOT_ALLOWED_MESSAGE } from "./salesChannel";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryContinuation,
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
  locationSelection: DiscoveryLocation;
  target: number;
  criteria: string;
};

const BUDGET_PER_PROSPECT_USD = 0.003;
const LOCATION_DEBOUNCE_MS = 250;

function discoveryActionFailure(error: unknown): ActionFailure {
  const failure = actionFailureFromError({
    action: "prospect-search",
    stage: "campaign-start",
    error,
    code:
      error instanceof Error && error.message === SALES_NOT_ALLOWED_MESSAGE
        ? "sales_channel_not_allowed"
        : null,
  });
  logActionFailure(failure);
  return failure;
}

function startFailureMessage(error: unknown): string {
  return discoveryActionFailure(error).message;
}

function activeRelayUrl(): string | null {
  const activeId = loadActiveCommunityId();
  return (
    loadCommunities().find((community) => community.id === activeId)
      ?.relayUrl ?? null
  );
}

function browserLocationStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * Keyboard-first location picker. Typing is deliberately not selection: place
 * names repeat across countries, so starting a paid search requires an exact
 * relay-geocoded result.
 */
function LocationCombobox({
  location,
  onLocationChange,
  onSelect,
  selected,
}: {
  location: string;
  onLocationChange: (location: string) => void;
  onSelect: (location: DiscoveryLocation | null) => void;
  selected: DiscoveryLocation | null;
}) {
  const inputId = React.useId();
  const listId = `${inputId}-options`;
  const [focused, setFocused] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<DiscoveryLocation[]>(
    () => readRecentDiscoveryLocations(browserLocationStorage()),
  );
  const [recents, setRecents] = React.useState<DiscoveryLocation[]>(() =>
    readRecentDiscoveryLocations(browserLocationStorage()),
  );
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const query = location.trim();
  const relayUrl = activeRelayUrl();
  const hasE2eHook =
    typeof window !== "undefined" &&
    Boolean(window.__BUZZ_E2E_DISCOVERY_LOCATIONS__);
  const options = query.length < 2 ? recents : suggestions;
  const open = focused && options.length > 0;

  React.useEffect(() => {
    setActiveIndex(-1);
    if (query.length < 2) {
      setSuggestions(recents);
      setLoading(false);
      setError("");
      return;
    }
    if (!relayUrl && !hasE2eHook) {
      setSuggestions([]);
      setLoading(false);
      setError("Location suggestions need an active community connection.");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void searchDiscoveryLocations({
        relayUrl: relayUrl ?? "wss://e2e.invalid",
        request: { query },
        signal: controller.signal,
      })
        .then((next) => {
          if (!controller.signal.aborted) setSuggestions(next);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setError(
            searchError instanceof Error && searchError.message.trim()
              ? searchError.message
              : "Location suggestions are unavailable. Try again.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, LOCATION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hasE2eHook, query, recents, relayUrl]);

  function choose(next: DiscoveryLocation) {
    const selectedWithNearby = attachNearbyLocations(next, suggestions);
    const remembered = rememberDiscoveryLocation(
      browserLocationStorage(),
      selectedWithNearby,
    );
    setRecents(remembered);
    onLocationChange(selectedWithNearby.label);
    onSelect(selectedWithNearby);
    setFocused(false);
    setActiveIndex(-1);
  }

  function change(value: string) {
    onLocationChange(value);
    if (value.trim() !== selected?.label.trim()) onSelect(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocused(true);
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocused(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      const candidate = options[activeIndex];
      if (candidate) {
        event.preventDefault();
        choose(candidate);
      }
    } else if (event.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
    }
  }

  const needsSelection = Boolean(query) && selected === null;
  return (
    <div className="c3d-field c3d-location-combobox">
      <label htmlFor={inputId}>Location</label>
      <div className="c3d-location-input-wrap">
        <input
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={`${inputId}-hint`}
          aria-expanded={open}
          aria-invalid={needsSelection || undefined}
          autoComplete="off"
          id={inputId}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => change(event.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a city, suburb, region or country"
          role="combobox"
          value={location}
        />
        {open ? (
          <div
            aria-label="Location suggestions"
            className="c3d-location-options"
            id={listId}
            role="listbox"
          >
            {options.map((option, index) => (
              <div
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "is-active" : undefined}
                id={`${listId}-${index}`}
                key={`${option.label}-${option.latitude}-${option.longitude}`}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option);
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
              >
                <strong>{option.label}</strong>
                <span>{option.kind}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <p className="c3d-location-hint" id={`${inputId}-hint`}>
        {loading
          ? "Finding places…"
          : needsSelection
            ? "Pick a place from the list before starting this search."
            : selected
              ? `Selected ${selected.label}.`
              : "Type at least two characters to find a place."}
      </p>
      {error ? (
        <p className="c3d-location-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
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
  continuationSourceCampaign,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CampaignFormInput) => Promise<void>;
  open: boolean;
  pending: PendingCampaign | null;
  /** Who will run the search; the line is left out when unknown. */
  runner: DiscoveryRunner | null;
  /** The test-build stand-in keeps the design's example wording. */
  simulatedCosts: boolean;
  initialLocation?: DiscoveryLocation | null;
  /** A nearby place is intentionally a separate campaign, not Find more. */
  continuationSourceCampaign?: string | null;
}) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [locationSelection, setLocationSelection] =
    React.useState<DiscoveryLocation | null>(null);
  const [target, setTarget] = React.useState("100");
  const [criteria, setCriteria] = React.useState("");
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [failure, setFailure] = React.useState<ActionFailure | null>(null);
  const [detailsCopied, setDetailsCopied] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const budget = Math.max(0, Number(target) || 0) * BUDGET_PER_PROSPECT_USD;

  React.useEffect(() => {
    if (!open || !pending) return;
    setName(
      continuationSourceCampaign
        ? `Continues ${continuationSourceCampaign}`
        : `${pending.verticalName} prospects`,
    );
    setLocation(initialLocation?.label ?? "");
    setLocationSelection(initialLocation ?? null);
    setTarget("100");
    setCriteria("");
    setApproved(false);
    setError("");
    setFailure(null);
    setDetailsCopied(false);
  }, [continuationSourceCampaign, initialLocation, open, pending]);

  async function copyFailureDetails() {
    if (!failure) return;
    try {
      await copyTextToSystemClipboard(failure.details);
      setDetailsCopied(true);
    } catch {
      setDetailsCopied(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setDetailsCopied(false);
    const requested = Number(target);
    if (
      !locationSelection ||
      location.trim() !== locationSelection.label.trim()
    ) {
      setError("Pick a place from the list before starting this search.");
      return;
    }
    if (
      !location.trim() ||
      !Number.isInteger(requested) ||
      requested < 100 ||
      requested > 500 ||
      !approved
    ) {
      setError("Choose 100 to 500 prospects and approve the maximum budget.");
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
        locationSelection,
        target: requested,
        criteria,
      });
    } catch (startError) {
      const nextFailure = discoveryActionFailure(startError);
      setFailure(nextFailure);
      setError(nextFailure.message);
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
          <p className="c3d-eyebrow">
            {continuationSourceCampaign
              ? "New campaign for a nearby area"
              : "New discovery campaign"}
          </p>
          <DialogTitle className="c3d-dialog-title">
            {continuationSourceCampaign
              ? "Continue in a nearby area."
              : "Find the right fit."}
          </DialogTitle>
          <DialogDescription className="c3d-dialog-sub">
            {continuationSourceCampaign
              ? `This starts a new campaign that continues ${continuationSourceCampaign} in a different place.`
              : pending
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
            <LocationCombobox
              location={location}
              onLocationChange={setLocation}
              onSelect={setLocationSelection}
              selected={locationSelection}
            />
            <div className="c3d-field">
              <label htmlFor="w10-campaign-target">Prospect target</label>
              <input
                id="w10-campaign-target"
                max={500}
                min={100}
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
                  : "About US$0.06 per 20 results. This is the maximum you approve."}
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
            <div className="c3d-error" role="alert">
              {failure ? (
                <>
                  <strong>{failure.title}</strong>
                  <span>{error}</span>
                  <button
                    className="c3d-error-copy"
                    data-testid="discovery-failure-copy-details"
                    onClick={() => void copyFailureDetails()}
                    type="button"
                  >
                    {detailsCopied ? "Copied" : "Copy details"}
                  </button>
                </>
              ) : (
                error
              )}
            </div>
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
              Approve &amp; {continuationSourceCampaign ? "start new" : "start"}{" "}
              <ArrowRightGlyph size={16} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approval for an in-place continuation after a campaign used its budget. */
export function DiscoveryContinuationDialog({
  campaign,
  continuation,
  onOpenChange,
  onSubmit,
  open,
}: {
  campaign: DiscoveryCampaign;
  continuation: DiscoveryContinuation | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (additionalBudgetUsd: number) => Promise<void>;
  open: boolean;
}) {
  const [additionalBudget, setAdditionalBudget] = React.useState("0");
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const approvedBudget = continuation?.approvedBudgetUsd ?? campaign.budgetUsd;
  const spent = continuation?.spentUsd ?? campaign.spentUsd ?? 0;
  const remainingTarget = continuation?.remainingTarget ?? 0;
  const estimatedPages = continuation?.estimatedPages ?? 0;
  const pagesAtProviderCeiling = continuation?.pagesAtProviderCeiling ?? 0;
  const estimatedCost = continuation?.estimatedCostUsd ?? 0;
  const minimum = continuation?.minimumAdditionalBudgetUsd ?? 0;

  React.useEffect(() => {
    if (!open || !continuation) return;
    setAdditionalBudget(continuation.recommendedAdditionalBudgetUsd.toFixed(2));
    setApproved(false);
    setError("");
  }, [continuation, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(additionalBudget);
    if (!Number.isFinite(amount) || amount < minimum || !approved) {
      setError(
        `Approve at least ${formatBudget(minimum)} more to cover the next provider page.`,
      );
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(amount);
      onOpenChange(false);
    } catch (continueError) {
      setError(startFailureMessage(continueError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3d-dialog c3d-dialog--form"
        data-testid="discovery-continuation-dialog"
        showCloseButton={false}
      >
        <div className="c3d-dialog-head">
          <p className="c3d-eyebrow">Continue this campaign</p>
          <DialogTitle className="c3d-dialog-title">
            Approve more search budget.
          </DialogTitle>
          <DialogDescription className="c3d-dialog-sub">
            {campaign.name} · {remainingTarget} new prospects remaining
          </DialogDescription>
        </div>
        <form
          className="contents"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <dl className="c3d-facts">
            <dt>Campaign</dt>
            <dd>{campaign.name}</dd>
            <dt>Spent</dt>
            <dd>
              {formatBudget(spent)} of {formatBudget(approvedBudget)} approved
            </dd>
            <dt>Target</dt>
            <dd>
              {campaign.count} new saved · {remainingTarget} remaining
            </dd>
          </dl>
          <div className="c3d-field">
            <label htmlFor="w10-continuation-budget">
              Additional budget to approve
            </label>
            <input
              id="w10-continuation-budget"
              min={minimum.toFixed(2)}
              onChange={(event) =>
                setAdditionalBudget(event.currentTarget.value)
              }
              required
              step="0.01"
              type="number"
              value={additionalBudget}
            />
          </div>
          <div className="c3d-budget">
            <span>
              <strong>What this estimate covers</strong>
              <small>
                At $0.003 per returned record, {remainingTarget} new prospects
                need at least {estimatedPages}{" "}
                {estimatedPages === 1 ? "page" : "pages"} and{" "}
                {formatBudget(estimatedCost)}. Results already in your Leads are
                skipped, so it may take more pages. This query can use up to{" "}
                {pagesAtProviderCeiling}{" "}
                {pagesAtProviderCeiling === 1 ? "page" : "pages"} before the
                400-record provider ceiling.
              </small>
            </span>
            <span className="c3d-budget-amount">
              {formatBudget(Math.max(0, Number(additionalBudget) || 0))}
            </span>
          </div>
          <label className="c3d-approval">
            <input
              checked={approved}
              onChange={(event) => setApproved(event.currentTarget.checked)}
              type="checkbox"
            />
            I approve this additional search budget for the same campaign.
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
              disabled={submitting || !continuation}
              type="submit"
            >
              Approve &amp; continue <ArrowRightGlyph size={16} />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
