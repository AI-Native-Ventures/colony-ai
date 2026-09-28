import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  Globe,
  GitBranch,
  Grid2X2,
  Heart,
  House,
  Leaf,
  Plus,
  Settings,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  useDiscoveryCampaign,
  type DiscoveryCampaign,
  type DiscoveryCampaignInput,
} from "./discoveryProvider";
import { Field, W10Button, W10Pill } from "./BusinessCommon";

import {
  countPeopleRoles,
  countVerticals,
  industryTaxonomy,
  peopleTaxonomy,
  searchCatalogue,
} from "./taxonomy";

type PendingCampaign = Pick<
  DiscoveryCampaignInput,
  "audience" | "industryId" | "industryName" | "verticalId" | "verticalName"
>;

const CATEGORY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  "home-living": House,
  healthcare: Heart,
  technology: Grid2X2,
  education: BookOpen,
  agriculture: Leaf,
  finance: GitBranch,
  legal: BriefcaseBusiness,
  "real-estate": Building2,
  tourism: Globe,
  construction: Building2,
  engineering: Settings,
  medicine: Heart,
  law: BriefcaseBusiness,
  marketing: Sparkles,
  design: Leaf,
};

export function DiscoveryScreen() {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const [mode, setMode] = React.useState<"businesses" | "people">("businesses");
  const [query, setQuery] = React.useState("");
  const [industryId, setIndustryId] = React.useState<string | null>(null);
  const [pendingCampaign, setPendingCampaign] =
    React.useState<PendingCampaign | null>(null);
  const [campaignDialogOpen, setCampaignDialogOpen] = React.useState(false);
  const [campaignListOpen, setCampaignListOpen] = React.useState(false);
  const [campaignList, setCampaignList] = React.useState<DiscoveryCampaign[]>(
    [],
  );
  const categories = mode === "businesses" ? industryTaxonomy : peopleTaxonomy;
  const selectedCategory = industryId
    ? (categories.find((category) => category.id === industryId) ?? null)
    : null;
  const rows = searchCatalogue(mode, query, query.trim() ? null : industryId);

  function switchMode(nextMode: "businesses" | "people") {
    setMode(nextMode);
    setIndustryId(null);
    setQuery("");
  }

  function openCampaignForm(input: PendingCampaign) {
    if (!provider) return;
    setPendingCampaign(input);
    setCampaignDialogOpen(true);
  }

  async function startCampaign(input: {
    name: string;
    location: string;
    target: number;
    criteria: string;
  }) {
    if (!provider || !pendingCampaign) return;
    await provider.start({ ...pendingCampaign, ...input });
    setCampaignDialogOpen(false);
    await navigate({ to: "/campaign" });
  }

  async function selectCampaign(campaignId: string) {
    if (!provider) return;
    await provider.select(campaignId);
    setCampaignListOpen(false);
    await navigate({ to: "/campaign" });
  }

  return (
    <>
      <main className="w10-root w10-discovery" data-testid="w10-discovery-page">
        <div className="w10-page w10-page-wide">
          <header className="w10-discovery-intro">
            <h1>Find your next customer.</h1>
            <p>
              Explore a market. Find the right people. Start a conversation.
            </p>
            <div className="w10-discovery-controls">
              <fieldset className="w10-discovery-toggle">
                <legend className="sr-only">Discovery audience</legend>
                <button
                  aria-pressed={mode === "businesses"}
                  className={mode === "businesses" ? "is-active" : ""}
                  onClick={() => switchMode("businesses")}
                  type="button"
                >
                  <Building2 aria-hidden="true" />
                  Businesses
                </button>
                <button
                  aria-pressed={mode === "people"}
                  className={mode === "people" ? "is-active" : ""}
                  onClick={() => switchMode("people")}
                  type="button"
                >
                  <Users aria-hidden="true" />
                  People
                </button>
              </fieldset>
              <label className="w10-catalogue-search">
                <Search aria-hidden="true" />
                <span className="sr-only">
                  Search{" "}
                  {mode === "businesses"
                    ? "industries and verticals"
                    : "fields and roles"}
                </span>
                <input
                  autoComplete="off"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder={
                    mode === "businesses"
                      ? "Try home decor, accounting, healthcare…"
                      : "Try designers, sales managers, accountants…"
                  }
                  value={query}
                />
                {query ? (
                  <button
                    aria-label="Clear search"
                    className="w10-quiet-button"
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    Clear
                  </button>
                ) : (
                  <kbd>Search</kbd>
                )}
              </label>
            </div>
          </header>

          {campaign ? (
            <section className="w10-discovery-recent">
              <div className="w10-section-heading w10-discovery-recent-heading">
                <h2>Pick up where you left off</h2>
                <button
                  className="w10-text-button"
                  onClick={() => {
                    setCampaignList(provider?.getCampaigns() ?? []);
                    setCampaignListOpen(true);
                  }}
                  type="button"
                >
                  All campaigns <ArrowRight aria-hidden="true" />
                </button>
              </div>
              <a className="w10-campaign-resume" href="#/campaign">
                <span aria-hidden="true" className="w10-campaign-symbol">
                  <Leaf />
                </span>
                <span className="w10-campaign-copy">
                  <strong>{campaign.name}</strong>
                  <small>
                    {campaign.verticalName} · {campaign.location}
                  </small>
                </span>
                <span className="w10-campaign-count">
                  {campaign.count}
                  <small>prospects</small>
                </span>
                <W10Pill tone={campaign.status === "failed" ? "red" : "blue"}>
                  {campaign.status === "complete"
                    ? "Ready to review"
                    : campaign.status}
                </W10Pill>
                <ArrowRight aria-hidden="true" />
              </a>
            </section>
          ) : null}

          <section aria-label="Discovery catalogue" className="w10-catalogue">
            {query.trim() ? (
              <>
                <div className="w10-section-heading">
                  <h2>
                    {rows.length}{" "}
                    {mode === "businesses" ? "verticals" : "roles"}
                  </h2>
                  <button
                    className="w10-text-button"
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    Clear search
                  </button>
                </div>
                {rows.length ? (
                  <VerticalList
                    canFind={Boolean(provider)}
                    onFind={(row) =>
                      openCampaignForm({
                        audience: mode,
                        industryId: row.parentId,
                        industryName: row.parentName,
                        verticalId: row.id,
                        verticalName: row.name,
                      })
                    }
                    rows={rows}
                    searching
                  />
                ) : (
                  <EmptyCatalogue onClear={() => setQuery("")} />
                )}
              </>
            ) : selectedCategory ? (
              <>
                <div className="w10-section-heading">
                  <button
                    className="w10-text-button"
                    onClick={() => setIndustryId(null)}
                    type="button"
                  >
                    <ArrowLeft aria-hidden="true" />
                    All {mode === "businesses" ? "industries" : "fields"}
                  </button>
                  <span>
                    {mode === "businesses"
                      ? `${"verticals" in selectedCategory ? selectedCategory.verticals.length : 0} verticals`
                      : `${"roles" in selectedCategory ? selectedCategory.roles.length : 0} roles`}
                  </span>
                </div>
                <h2 className="w10-category-title">
                  {"label" in selectedCategory
                    ? selectedCategory.label
                    : selectedCategory.name}
                </h2>
                <VerticalList
                  canFind={Boolean(provider)}
                  onFind={(row) =>
                    openCampaignForm({
                      audience: mode,
                      industryId: row.parentId,
                      industryName: row.parentName,
                      verticalId: row.id,
                      verticalName: row.name,
                    })
                  }
                  rows={rows}
                />
              </>
            ) : (
              <>
                <div className="w10-section-heading">
                  <h2>
                    Browse{" "}
                    {mode === "businesses"
                      ? "industries"
                      : "professional fields"}
                  </h2>
                  <span>
                    {mode === "businesses"
                      ? `${industryTaxonomy.length} industries · ${countVerticals()} verticals`
                      : `${peopleTaxonomy.length} fields · ${countPeopleRoles()} roles`}
                  </span>
                </div>
                <div className="w10-industry-grid">
                  {categories.map((category) => {
                    const id = category.id;
                    const label =
                      "label" in category ? category.label : category.name;
                    const count =
                      mode === "businesses"
                        ? "verticals" in category
                          ? category.verticals.length
                          : 0
                        : "roles" in category
                          ? category.roles.length
                          : 0;
                    const Icon = CATEGORY_ICONS[id] ?? BriefcaseBusiness;
                    return (
                      <button
                        className="w10-industry-card"
                        key={id}
                        onClick={() => setIndustryId(id)}
                        type="button"
                      >
                        <span className="w10-industry-icon">
                          <Icon aria-hidden="true" />
                        </span>
                        <span className="w10-industry-copy">
                          <strong>{label}</strong>
                          <small>
                            {count}{" "}
                            {mode === "businesses" ? "verticals" : "roles"}
                          </small>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <DiscoveryCampaignDialog
        onOpenChange={setCampaignDialogOpen}
        onSubmit={startCampaign}
        open={campaignDialogOpen}
        pending={pendingCampaign}
      />
      <DiscoveryCampaignListDialog
        campaigns={campaignList}
        onOpenChange={setCampaignListOpen}
        onSelect={(campaignId) => void selectCampaign(campaignId)}
        onStartNew={() => setCampaignListOpen(false)}
        open={campaignListOpen}
      />
    </>
  );
}

function VerticalList({
  rows,
  searching = false,
  canFind,
  onFind,
}: {
  rows: ReturnType<typeof searchCatalogue>;
  searching?: boolean;
  canFind: boolean;
  onFind: (row: ReturnType<typeof searchCatalogue>[number]) => void;
}) {
  return (
    <div className="w10-vertical-list">
      {rows.map((row) => {
        const Icon = CATEGORY_ICONS[row.parentId] ?? BriefcaseBusiness;
        return (
          <article
            className="w10-vertical-row"
            key={`${row.parentId}:${row.id}`}
          >
            <span className="w10-industry-icon">
              <Icon aria-hidden="true" />
            </span>
            <span className="w10-vertical-copy">
              <strong>{row.name}</strong>
              <small>
                {searching
                  ? row.parentName
                  : row.description || "Find professionals in this role"}
              </small>
            </span>
            <button
              className="w10-vertical-action"
              disabled={!canFind}
              onClick={() => onFind(row)}
              type="button"
            >
              Find prospects
              <ArrowRight aria-hidden="true" />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function EmptyCatalogue({ onClear }: { onClear: () => void }) {
  return (
    <div className="w10-empty-state">
      <h2>No matching categories.</h2>
      <p>Try a broader industry, profession or keyword.</p>
      <button className="w10-secondary-button" onClick={onClear} type="button">
        Browse all categories
      </button>
    </div>
  );
}

function DiscoveryCampaignDialog({
  onOpenChange,
  onSubmit,
  open,
  pending,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    name: string;
    location: string;
    target: number;
    criteria: string;
  }) => Promise<void>;
  open: boolean;
  pending: PendingCampaign | null;
}) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("Johannesburg");
  const [target, setTarget] = React.useState("50");
  const [criteria, setCriteria] = React.useState("");
  const [approved, setApproved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const budget = Math.max(0, Number(target) || 0) * 0.05;

  React.useEffect(() => {
    if (!open || !pending) return;
    setName(`${pending.verticalName} prospects`);
    setLocation("Johannesburg");
    setTarget("50");
    setCriteria("");
    setApproved(false);
    setError("");
  }, [open, pending]);

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
    } catch {
      setError(
        "The campaign could not be started. Retry when the connection is available.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w10-dialog" showCloseButton={false}>
        <DialogHeader>
          <p className="w10-dialog-eyebrow">New discovery campaign</p>
          <DialogTitle>Find the right fit.</DialogTitle>
          <DialogDescription>
            {pending
              ? `${pending.industryName} / ${pending.verticalName}`
              : "Choose a category."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="w10-form"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <Field
            id="w10-campaign-name"
            label="Campaign name"
            onChange={setName}
            required
            value={name}
          />
          <div className="w10-field-grid">
            <Field
              id="w10-campaign-location"
              label="Location"
              onChange={setLocation}
              placeholder="City, region or country"
              required
              value={location}
            />
            <Field
              id="w10-campaign-target"
              label="Prospect target"
              max={500}
              min={1}
              onChange={setTarget}
              required
              type="number"
              value={target}
            />
          </div>
          <Field
            id="w10-campaign-criteria"
            label="What makes a good fit? Optional"
            onChange={setCriteria}
            placeholder="For example, independent stores that carry locally made products…"
            rows={3}
            value={criteria}
          />
          <div className="w10-budget-preview">
            <div>
              <span>Maximum search budget</span>
              <strong>${budget.toFixed(2)}</strong>
            </div>
            <small>
              Example pricing · Actual results and costs are simulated.
            </small>
          </div>
          <label className="w10-approval-check">
            <input
              checked={approved}
              onChange={(event) => setApproved(event.currentTarget.checked)}
              type="checkbox"
            />
            I approve this campaign’s maximum budget.
          </label>
          {error ? (
            <p className="w10-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="w10-dialog-actions">
            <W10Button
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </W10Button>
            <W10Button
              disabled={submitting || !pending}
              type="submit"
              variant="primary"
            >
              Approve &amp; start <ArrowRight aria-hidden="true" />
            </W10Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DiscoveryCampaignListDialog({
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
      <DialogContent className="w10-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Your discovery campaigns.</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a campaign to review.
          </DialogDescription>
        </DialogHeader>
        <div className="w10-campaign-list">
          {campaigns.map((campaign) => (
            <button
              className="w10-campaign-list-item"
              key={campaign.id}
              onClick={() => onSelect(campaign.id)}
              type="button"
            >
              <span className="w10-campaign-symbol">
                <Leaf aria-hidden="true" />
              </span>
              <span>
                <strong>{campaign.name}</strong>
                <small>
                  {campaign.location} · {campaign.count} prospects ·{" "}
                  {campaign.status}
                </small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="w10-dialog-actions">
          <W10Button disabled={!campaigns.length} onClick={onStartNew}>
            Start a new campaign <Plus aria-hidden="true" />
          </W10Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
