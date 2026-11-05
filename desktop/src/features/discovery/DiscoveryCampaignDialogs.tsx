import * as React from "react";

import {
  loadActiveCommunityId,
  loadCommunities,
} from "@/features/communities/communityStorage";
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
import {
  attachNearbyLocations,
  readRecentDiscoveryLocations,
  rememberDiscoveryLocation,
  type DiscoveryLocation,
} from "./discoveryLocation";
import { searchDiscoveryLocations } from "./discoveryLocationClient";
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
  locationSelection: DiscoveryLocation;
  target: number;
  criteria: string;
};

const BUDGET_PER_PROSPECT_USD = 0.003;
const LOCATION_DEBOUNCE_MS = 250;

function startFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The campaign could not be started. Retry when the connection is available.";
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
}) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [locationSelection, setLocationSelection] =
    React.useState<DiscoveryLocation | null>(null);
  const [target, setTarget] = React.useState("100");
  const [criteria, setCriteria] = React.useState("");
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const budget = Math.max(0, Number(target) || 0) * BUDGET_PER_PROSPECT_USD;

  React.useEffect(() => {
    if (!open || !pending) return;
    setName(`${pending.verticalName} prospects`);
    setLocation(initialLocation?.label ?? "");
    setLocationSelection(initialLocation ?? null);
    setTarget("100");
    setCriteria("");
    setApproved(false);
    setError("");
  }, [initialLocation, open, pending]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
