import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { campaignStatusLabel } from "./CampaignHelpers";
import { DiscoveryBusinessCatalogue } from "./DiscoveryBusinessCatalogue";
import {
  DiscoveryCampaignDialog,
  DiscoveryCampaignListDialog,
  type PendingCampaign,
} from "./DiscoveryCampaignDialogs";
import {
  ArrowLeftGlyph,
  ArrowRightGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  IndustryGlyph,
  ReturnGlyph,
  SearchGlyph,
  industryTileColour,
} from "./DiscoveryIcons";
import { RunnerAvatar, useCurrentRunner } from "./DiscoveryRunner";
import {
  useDiscoveryCampaign,
  type DiscoveryCampaign,
} from "./discoveryProvider";
import {
  countPeopleRoles,
  industryTaxonomy,
  loadVerticalTags,
  peopleTaxonomy,
  searchCatalogue,
} from "./taxonomy";

import "./colony3-discovery.css";

type CatalogueRows = ReturnType<typeof searchCatalogue>;
type Category =
  | (typeof industryTaxonomy)[number]
  | (typeof peopleTaxonomy)[number];

/** The twelve industries the board opens with; the rest sit behind "Show all". */
const FEATURED_FALLBACK_COUNT = 12;

function categoryLabel(category: Category): string {
  return "label" in category ? category.label : category.name;
}

function categoryCount(category: Category): number {
  if ("verticals" in category) return category.verticals.length;
  return category.roles.length;
}

function categoryDescription(category: Category): string | null {
  return "description" in category && category.description
    ? category.description
    : null;
}

function standInInstalled(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__)
  );
}

/**
 * The design lists whole sentences only, as many as fit the two-line row
 * (about 190 characters). The taxonomy keeps the long market notes; the row
 * shows the first sentences of them.
 */
const SUMMARY_LIMIT = 190;
export function summarizeDescription(description: string | undefined): string {
  const text = (description ?? "").trim();
  if (text.length <= SUMMARY_LIMIT) return text;
  const sentences = text.match(/.+?(?:[.!?](?=\s|$)|$)/g) ?? [text];
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary} ${sentence}`.trim();
    if (summary && next.length > SUMMARY_LIMIT) break;
    summary = next;
  }
  return summary;
}

export function DiscoveryScreen() {
  const navigate = useNavigate();
  const { campaign, provider } = useDiscoveryCampaign();
  const currentRunner = useCurrentRunner();
  const [mode, setMode] = React.useState<"businesses" | "people">("businesses");
  const [query, setQuery] = React.useState("");
  const [industryId, setIndustryId] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [pendingCampaign, setPendingCampaign] =
    React.useState<PendingCampaign | null>(null);
  const [campaignDialogOpen, setCampaignDialogOpen] = React.useState(false);
  const [campaignListOpen, setCampaignListOpen] = React.useState(false);
  const [campaignList, setCampaignList] = React.useState<DiscoveryCampaign[]>(
    [],
  );
  // The tag layer loads once when Discovery opens; the open search re-runs when it lands.
  const [, setTagsLoaded] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void loadVerticalTags().then((loaded) => {
      if (live && loaded) setTagsLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const categories: readonly Category[] =
    mode === "businesses" ? industryTaxonomy : peopleTaxonomy;
  const selectedCategory = industryId
    ? (categories.find((category) => category.id === industryId) ?? null)
    : null;
  const searching = query.trim().length > 0;
  const compact = selectedCategory !== null && !searching;
  const rows = searchCatalogue(
    mode,
    query,
    mode === "businesses"
      ? (selectedCategory?.id ?? null)
      : searching
        ? null
        : industryId,
  );
  const featured = React.useMemo(
    () => categories.slice(0, FEATURED_FALLBACK_COUNT),
    [categories],
  );
  const visibleCategories = showAll ? categories : featured;
  const simulatedCosts = standInInstalled();
  const dialogRunner = simulatedCosts
    ? (campaign?.runBy ?? currentRunner)
    : currentRunner;

  function switchMode(nextMode: "businesses" | "people") {
    setMode(nextMode);
    setIndustryId(null);
    setShowAll(false);
    setQuery("");
  }

  function openCampaignForm(input: PendingCampaign) {
    if (!provider) return;
    setPendingCampaign(input);
    setCampaignDialogOpen(true);
  }

  function findProspects(row: CatalogueRows[number]) {
    openCampaignForm({
      audience: mode,
      industryId: row.parentId,
      industryName: row.parentName,
      verticalId: row.id,
      verticalName: row.name,
    });
  }

  async function startCampaign(input: {
    name: string;
    location: string;
    target: number;
    criteria: string;
  }) {
    if (!provider || !pendingCampaign) return;
    await provider.start({
      ...pendingCampaign,
      ...input,
      runBy: dialogRunner,
    });
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
      <main className="c3d-root" data-testid="w10-discovery-page">
        {compact && selectedCategory ? (
          <AppTopChromePortal>
            <nav
              aria-label="Breadcrumb"
              className="c3d-crumbs"
              data-testid="discovery-category-breadcrumb"
            >
              <span>Business</span>
              <span aria-hidden="true">/</span>
              <button
                className="c3d-crumb-link"
                onClick={() => setIndustryId(null)}
                type="button"
              >
                Discovery
              </button>
              <span aria-hidden="true">/</span>
              <span aria-current="page" data-current="true">
                {categoryLabel(selectedCategory)}
              </span>
            </nav>
          </AppTopChromePortal>
        ) : null}
        <div className={`c3d-page${compact ? " is-compact" : ""}`}>
          <section aria-labelledby="discovery-title" className="c3d-intro">
            <div className="c3d-intro-row">
              <div className="c3d-intro-copy">
                <h1 className="c3d-title" id="discovery-title">
                  Find your next customer.
                </h1>
                <p className="c3d-subtitle">
                  Explore a market. Find the right people. Start a conversation.
                </p>
              </div>
              <fieldset className="c3d-segment">
                <legend className="sr-only">Search for</legend>
                <button
                  aria-pressed={mode === "businesses"}
                  onClick={() => switchMode("businesses")}
                  type="button"
                >
                  Businesses
                </button>
                <button
                  aria-pressed={mode === "people"}
                  onClick={() => switchMode("people")}
                  type="button"
                >
                  People
                </button>
              </fieldset>
            </div>
            <label className="c3d-search">
              <SearchGlyph />
              <input
                aria-label={
                  mode === "businesses"
                    ? selectedCategory
                      ? "Search business types in " +
                        categoryLabel(selectedCategory)
                      : "Search industries and business types"
                    : "Search fields and roles"
                }
                autoComplete="off"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={
                  mode === "businesses"
                    ? selectedCategory
                      ? "Find a business type in " +
                        categoryLabel(selectedCategory) +
                        "…"
                      : "Try home decor, accounting, healthcare…"
                    : "Try designers, sales managers, accountants…"
                }
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear search"
                  className="c3d-search-chip"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  Clear
                </button>
              ) : (
                <span className="c3d-search-chip">
                  Search
                  {compact ? null : <ReturnGlyph />}
                </span>
              )}
            </label>
          </section>

          {campaign && !compact ? (
            <ResumeSection
              campaign={campaign}
              onAll={() => {
                setCampaignList(provider?.getCampaigns() ?? []);
                setCampaignListOpen(true);
              }}
            />
          ) : null}

          <section aria-label="Discovery catalogue" className="c3d-section">
            {mode === "businesses" ? (
              <DiscoveryBusinessCatalogue
                canFind={Boolean(provider)}
                category={
                  selectedCategory && "verticals" in selectedCategory
                    ? selectedCategory
                    : null
                }
                onBack={() => setIndustryId(null)}
                onFind={findProspects}
                onSelectCategory={setIndustryId}
                query={query}
                rows={rows}
              />
            ) : searching ? (
              <>
                <div className="c3d-section-head">
                  <h2 className="c3d-section-title">{rows.length} roles</h2>
                  <button
                    className="c3d-text-link"
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    Clear search
                  </button>
                </div>
                {rows.length ? (
                  <VerticalList
                    canFind={Boolean(provider)}
                    onFind={findProspects}
                    rows={rows}
                    searching
                  />
                ) : (
                  <EmptyCatalogue onClear={() => setQuery("")} />
                )}
              </>
            ) : selectedCategory ? (
              <div className="c3d-category">
                <div className="c3d-category-nav">
                  <button
                    className="c3d-back-chip"
                    onClick={() => setIndustryId(null)}
                    type="button"
                  >
                    <ArrowLeftGlyph />
                    All fields
                  </button>
                  <span className="c3d-section-meta">
                    {categoryCount(selectedCategory)} roles
                  </span>
                </div>
                <div className="c3d-category-head">
                  <span
                    className="c3d-tile c3d-tile--52"
                    style={{
                      background: industryTileColour(selectedCategory.id),
                    }}
                  >
                    <IndustryGlyph id={selectedCategory.id} size={24} />
                  </span>
                  <div className="c3d-category-name">
                    <h2>{categoryLabel(selectedCategory)}</h2>
                    {categoryDescription(selectedCategory) ? (
                      <span>{categoryDescription(selectedCategory)}</span>
                    ) : null}
                  </div>
                </div>
                <VerticalList
                  canFind={Boolean(provider)}
                  categoryId={selectedCategory.id}
                  label={categoryLabel(selectedCategory)}
                  onFind={findProspects}
                  rows={rows}
                />
              </div>
            ) : (
              <>
                <div className="c3d-section-head">
                  <h2 className="c3d-section-title" id="browse-title">
                    Browse professional fields
                  </h2>
                  <span className="c3d-section-meta">
                    {peopleTaxonomy.length} fields · {countPeopleRoles()} roles
                  </span>
                </div>
                <div className="c3d-industry-grid">
                  {visibleCategories.map((category) => (
                    <button
                      className="c3d-industry-card"
                      key={category.id}
                      onClick={() => setIndustryId(category.id)}
                      type="button"
                    >
                      <span
                        className="c3d-tile c3d-tile--44"
                        style={{ background: industryTileColour(category.id) }}
                      >
                        <IndustryGlyph id={category.id} size={20} />
                      </span>
                      <span className="c3d-industry-copy">
                        <strong>{categoryLabel(category)}</strong>
                        <span>{categoryCount(category)} roles</span>
                      </span>
                      <ChevronRightGlyph />
                    </button>
                  ))}
                </div>
                {showAll || categories.length <= featured.length ? null : (
                  <button
                    className="c3d-show-all"
                    onClick={() => setShowAll(true)}
                    type="button"
                  >
                    Show all {categories.length} fields
                  </button>
                )}
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
        runner={dialogRunner}
        simulatedCosts={simulatedCosts}
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

function statusTone(status: DiscoveryCampaign["status"]): string {
  if (status === "complete") return "c3d-pill--ok";
  if (status === "failed") return "c3d-pill--bad";
  if (status === "running") return "c3d-pill--info";
  return "c3d-pill--idle";
}

/** "Pick up where you left off": the campaign the last search belongs to. */
function ResumeSection({
  campaign,
  onAll,
}: {
  campaign: DiscoveryCampaign;
  onAll: () => void;
}) {
  return (
    <section aria-labelledby="resume-title" className="c3d-section">
      <div className="c3d-section-head">
        <h2 className="c3d-section-title" id="resume-title">
          Pick up where you left off
        </h2>
        <button className="c3d-text-link" onClick={onAll} type="button">
          All campaigns <span aria-hidden="true">→</span>
        </button>
      </div>
      <a className="c3d-resume" href="#/campaign">
        <span className="c3d-resume-copy">
          <strong className="c3d-resume-name">{campaign.name}</strong>
          <span className="c3d-resume-meta">
            {campaign.verticalName} · {campaign.location}
          </span>
          {campaign.runBy && campaign.postedInSales ? (
            <span className="c3d-resume-runner">
              <RunnerAvatar runner={campaign.runBy} size={24} />
              {campaign.runBy.name} ran this search and posted the results in
              #Sales
            </span>
          ) : null}
        </span>
        <span className="c3d-resume-count">
          <span className="c3d-resume-number">{campaign.count}</span>
          <span className="c3d-resume-count-label">
            <strong>prospects</strong>
            <span>of {campaign.target} requested</span>
          </span>
        </span>
        <span
          className={`c3d-pill c3d-pill--status ${statusTone(campaign.status)}`}
        >
          {campaign.status === "complete" ? (
            <CheckGlyph size={13} strokeWidth={3} />
          ) : null}
          {campaignStatusLabel(campaign.status)}
        </span>
        <span aria-hidden="true" className="c3d-resume-go">
          <ArrowRightGlyph />
        </span>
      </a>
    </section>
  );
}

function VerticalList({
  rows,
  searching = false,
  canFind,
  categoryId,
  label,
  onFind,
}: {
  rows: CatalogueRows;
  searching?: boolean;
  canFind: boolean;
  /** The industry the rows belong to, for the icon beside each row. */
  categoryId?: string;
  label?: string;
  onFind: (row: CatalogueRows[number]) => void;
}) {
  return (
    <ul
      aria-label={label ? `Verticals in ${label}` : undefined}
      className="c3d-vertical-list"
    >
      {rows.map((row) => (
        <li className="c3d-vertical-row" key={`${row.parentId}:${row.id}`}>
          <span aria-hidden="true" className="c3d-tile c3d-tile--40">
            <IndustryGlyph id={categoryId ?? row.parentId} size={18} />
          </span>
          <span className="c3d-vertical-copy">
            <strong>{row.name}</strong>
            <span>
              {searching
                ? row.parentName
                : summarizeDescription(row.description) ||
                  "Find professionals in this role"}
            </span>
          </span>
          <button
            className="c3d-btn c3d-btn--outline c3d-btn--sm"
            disabled={!canFind}
            onClick={() => onFind(row)}
            type="button"
          >
            Find prospects
            <span aria-hidden="true">→</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyCatalogue({ onClear }: { onClear: () => void }) {
  return (
    <div className="c3d-empty">
      <h2>No matching categories.</h2>
      <p>Try a broader industry, profession or keyword.</p>
      <button
        className="c3d-btn c3d-btn--outline c3d-btn--sm"
        onClick={onClear}
        type="button"
      >
        Browse all categories
      </button>
    </div>
  );
}
