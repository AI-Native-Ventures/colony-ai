import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import type {
  CatalogueType,
  CatalogueRow,
  IndustryCategory,
  TaxonomyVertical,
} from "./taxonomy";
import { countVerticals, findVertical, industryTaxonomy } from "./taxonomy";
import {
  ArrowLeftGlyph,
  ArrowRightGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  IndustryGlyph,
  PlusGlyph,
} from "./DiscoveryIcons";
import {
  discoveryCoverUrl,
  shouldShowDiscoveryCover,
  type DiscoveryCoverSize,
} from "./discoveryCovers";

function summarizeTypeDescription(description: string | undefined): string {
  const text = (description ?? "").trim();
  if (text.length <= 190) return text;
  const sentences = text.match(/.+?(?:[.!?](?=\s|$)|$)/g) ?? [text];
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary} ${sentence}`.trim();
    if (summary && next.length > 190) break;
    summary = next;
  }
  return summary;
}

type Props = {
  category: IndustryCategory | null;
  query: string;
  rows: CatalogueRow[];
  canFind: boolean;
  onSelectCategory: (categoryId: string) => void;
  onBack: () => void;
  onFind: (row: CatalogueRow) => void;
};

function normalized(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function industryMatches(category: IndustryCategory, query: string): boolean {
  const wanted = normalized(query);
  if (!wanted) return false;
  const content = normalized(
    [
      category.label,
      category.description ?? "",
      ...(category.sectors ?? []).map((sector) => sector.label),
    ].join(" "),
  );
  return (
    content.includes(wanted) ||
    wanted.split(" ").every((word) => content.includes(word))
  );
}

function industryUrl(id: string, size: DiscoveryCoverSize): string | null {
  return discoveryCoverUrl(id, size);
}

function CoverPicture({
  id,
  size,
  className,
  placeholder,
}: {
  id: string;
  size: DiscoveryCoverSize;
  className: string;
  placeholder: React.ReactNode;
}) {
  const url = industryUrl(id, size);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const showImage = shouldShowDiscoveryCover(id, size, failedUrl);

  return (
    <span aria-hidden="true" className={className}>
      {showImage && url ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailedUrl(url)}
          src={url}
        />
      ) : (
        <span className="d4-picture-placeholder">{placeholder}</span>
      )}
    </span>
  );
}

function industryRows(category: IndustryCategory): CatalogueRow[] {
  return category.verticals.map((type) => ({
    id: type.id,
    name: type.label,
    description: type.definition ?? type.description ?? "",
    parentId: category.id,
    parentName: category.label,
  }));
}

function catalogueType(row: CatalogueRow): TaxonomyVertical | undefined {
  return findVertical(row.id);
}

function otherIndustryNames(
  type: TaxonomyVertical,
  currentId?: string,
): string[] {
  return (type.industries ?? [])
    .filter((id) => id !== currentId)
    .map((id) => industryTaxonomy.find((industry) => industry.id === id)?.label)
    .filter((label): label is string => Boolean(label));
}

function typeRow(
  type: TaxonomyVertical,
  category?: IndustryCategory,
): CatalogueRow {
  const parentId = category?.id ?? type.industries?.[0] ?? "";
  const parentName =
    category?.label ??
    industryTaxonomy.find((industry) => industry.id === parentId)?.label ??
    "";
  return {
    id: type.id,
    name: type.label,
    description: type.definition ?? type.description ?? "",
    parentId,
    parentName,
  };
}

function DiscoveryTypeCard({
  type,
  row,
  currentIndustryId,
  selected,
  canFind,
  onDetails,
  onToggle,
  onFind,
}: {
  type: TaxonomyVertical;
  row: CatalogueRow;
  currentIndustryId?: string;
  selected: boolean;
  canFind: boolean;
  onDetails: (typeId: string) => void;
  onToggle: (typeId: string) => void;
  onFind: (row: CatalogueRow) => void;
}) {
  const otherNames = otherIndustryNames(type, currentIndustryId);
  const locationLabel = otherNames.length
    ? "Also in " +
      otherNames[0] +
      (otherNames.length > 1 ? ` +${String(otherNames.length - 1)}` : "")
    : row.parentName;

  return (
    <article
      className={`d4-type-card${selected ? " is-selected" : ""}`}
      data-testid={`discovery-type-card-${type.id}`}
    >
      <div className="d4-type-content">
        <CoverPicture
          className="d4-type-image"
          id={type.id}
          placeholder={<IndustryGlyph id={row.parentId} size={28} />}
          size={640}
        />
        <span className="d4-type-copy">
          <strong>{type.label}</strong>
          <span>
            {summarizeTypeDescription(type.definition ?? type.description)}
          </span>
        </span>
      </div>
      <button
        aria-label={`${(selected ? "Remove " : "Add ") + type.label} from selection`}
        aria-pressed={selected}
        className="d4-type-select"
        onClick={() => onToggle(type.id)}
        type="button"
      >
        {selected ? <CheckGlyph /> : <PlusGlyph />}
      </button>
      <div className="d4-type-footer">
        <span className="d4-type-related" title={locationLabel}>
          {locationLabel}
        </span>
        <button
          aria-label={`Details for ${type.label}`}
          className="d4-text-button"
          onClick={() => onDetails(type.id)}
          type="button"
        >
          Details <ArrowRightGlyph />
        </button>
        <button
          className="d4-find-button"
          disabled={!canFind}
          onClick={() => onFind(row)}
          type="button"
        >
          Find prospects
        </button>
      </div>
    </article>
  );
}

export function DiscoveryBusinessCatalogue({
  category,
  query,
  rows,
  canFind,
  onSelectCategory,
  onBack,
  onFind,
}: Props) {
  const [sectorSelection, setSectorSelection] = React.useState({
    categoryId: null as string | null,
    sectorId: "all",
  });
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [selectionOpen, setSelectionOpen] = React.useState(false);
  const currentCategoryId = category?.id ?? null;
  const sectorId =
    sectorSelection.categoryId === currentCategoryId
      ? sectorSelection.sectorId
      : "all";

  function updateSectorId(nextSectorId: string) {
    setSectorSelection({
      categoryId: currentCategoryId,
      sectorId: nextSectorId,
    });
  }

  const searching = query.trim().length > 0;
  const matchingIndustries = category
    ? []
    : industryTaxonomy.filter((industry) => industryMatches(industry, query));
  const selectedIdsInSearch = new Set(rows.map((row) => row.id));
  const sourceRows = category
    ? industryRows(category).filter(
        (row) =>
          (!searching || selectedIdsInSearch.has(row.id)) &&
          (sectorId === "all" ||
            catalogueType(row)?.sectors?.[category.id] === sectorId),
      )
    : searching
      ? rows
      : [];
  const visibleRows = sourceRows.filter((row) => catalogueType(row));
  const detailType = detailId ? findVertical(detailId) : undefined;
  const detailRow = detailType
    ? typeRow(detailType, category ?? undefined)
    : null;
  const selectedTypes = [...selectedIds]
    .map((id) => findVertical(id))
    .filter((type): type is CatalogueType => Boolean(type));
  const sectors = category?.sectors ?? [];

  function toggleType(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDetails(typeId: string) {
    setDetailId(typeId);
  }

  function findFromDetails() {
    if (!detailRow) return;
    setDetailId(null);
    onFind(detailRow);
  }

  return (
    <div className="d4-catalogue">
      {category ? (
        <section aria-labelledby="d4-industry-title" className="d4-category">
          <div className="d4-category-toolbar">
            <button className="d4-back-button" onClick={onBack} type="button">
              <ArrowLeftGlyph />
              All industries
            </button>
            <span>{category.verticals.length} business types</span>
          </div>
          <div className="d4-industry-hero">
            <CoverPicture
              className="d4-industry-cover"
              id={category.id}
              placeholder={<IndustryGlyph id={category.id} size={34} />}
              size={1200}
            />
            <div className="d4-industry-hero-copy">
              <p>INDUSTRY</p>
              <h2 id="d4-industry-title">{category.label}</h2>
              <span>
                {category.description ??
                  "Explore specialist businesses and services across " +
                    category.label.toLocaleLowerCase() +
                    "."}
              </span>
              <div className="d4-industry-meta">
                <span>{category.verticals.length} business types</span>
                <span>{sectors.length} sectors</span>
              </div>
            </div>
          </div>
          <section
            aria-labelledby="d4-sector-title"
            className="d4-sector-filter"
          >
            <div className="d4-sector-heading">
              <strong id="d4-sector-title">Filter by sector</strong>
              <span>Optional</span>
              {sectorId !== "all" ? (
                <button onClick={() => updateSectorId("all")} type="button">
                  Show all
                </button>
              ) : null}
            </div>
            <div className="d4-sector-chips">
              <button
                aria-pressed={sectorId === "all"}
                className="d4-sector-chip"
                onClick={() => updateSectorId("all")}
                type="button"
              >
                All types <span>{category.verticals.length}</span>
              </button>
              {sectors.map((sector) => {
                const count = category.verticals.filter(
                  (type) => type.sectorId === sector.id,
                ).length;
                return (
                  <button
                    aria-pressed={sectorId === sector.id}
                    className="d4-sector-chip"
                    key={sector.id}
                    onClick={() => updateSectorId(sector.id)}
                    type="button"
                  >
                    {sector.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="d4-results-heading">
            <h3>
              {sectorId === "all"
                ? "Business types"
                : sectors.find((sector) => sector.id === sectorId)?.label}
              <span>{visibleRows.length}</span>
            </h3>
            <span>Choose a type to explore</span>
          </div>
          {visibleRows.length ? (
            <div className="d4-type-grid">
              {visibleRows.map((row) => {
                const type = catalogueType(row);
                if (!type) return null;
                return (
                  <DiscoveryTypeCard
                    canFind={canFind}
                    currentIndustryId={category.id}
                    key={row.id}
                    onDetails={openDetails}
                    onFind={onFind}
                    onToggle={toggleType}
                    row={row}
                    selected={selectedIds.has(type.id)}
                    type={type}
                  />
                );
              })}
            </div>
          ) : (
            <div className="d4-empty">
              <h3>No business types match this filter.</h3>
              <p>Choose another sector or clear your search.</p>
            </div>
          )}
        </section>
      ) : searching ? (
        <>
          <div className="d4-results-heading d4-search-results-heading">
            <h2>
              {matchingIndustries.length} industries
              <span>{rows.length} business types</span>
            </h2>
          </div>
          {matchingIndustries.length ? (
            <div className="d4-industry-grid d4-search-industries">
              {matchingIndustries.map((industry) => (
                <button
                  className="d4-industry-card"
                  key={industry.id}
                  onClick={() => onSelectCategory(industry.id)}
                  type="button"
                >
                  <CoverPicture
                    className="d4-industry-card-image"
                    id={industry.id}
                    placeholder={<IndustryGlyph id={industry.id} size={30} />}
                    size={640}
                  />
                  <span className="d4-industry-card-caption">
                    <strong>{industry.label}</strong>
                    <small>{industry.verticals.length} business types</small>
                    <ChevronRightGlyph />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {rows.length ? (
            <div className="d4-type-grid d4-global-type-grid">
              {rows.map((row) => {
                const type = catalogueType(row);
                if (!type) return null;
                return (
                  <DiscoveryTypeCard
                    canFind={canFind}
                    key={row.id}
                    onDetails={openDetails}
                    onFind={onFind}
                    onToggle={toggleType}
                    row={row}
                    selected={selectedIds.has(type.id)}
                    type={type}
                  />
                );
              })}
            </div>
          ) : null}
          {!matchingIndustries.length && !rows.length ? (
            <div className="d4-empty">
              <h3>No matching industries or business types.</h3>
              <p>Try a broader search term.</p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="d4-results-heading">
            <h2 id="d4-industries-title">Browse industries</h2>
            <span>
              {industryTaxonomy.length} industries · {countVerticals()} business
              types
            </span>
          </div>
          <section
            aria-labelledby="d4-industries-title"
            className="d4-industry-grid"
          >
            {industryTaxonomy.map((industry) => (
              <button
                className="d4-industry-card"
                key={industry.id}
                onClick={() => onSelectCategory(industry.id)}
                type="button"
              >
                <CoverPicture
                  className="d4-industry-card-image"
                  id={industry.id}
                  placeholder={<IndustryGlyph id={industry.id} size={30} />}
                  size={640}
                />
                <span className="d4-industry-card-caption">
                  <strong>{industry.label}</strong>
                  <small>{industry.verticals.length} business types</small>
                  <ChevronRightGlyph />
                </span>
              </button>
            ))}
          </section>
        </>
      )}

      {selectedIds.size ? (
        <div className="d4-selection-strip">
          <span aria-hidden="true">
            <CheckGlyph />
          </span>
          <div>
            <strong>
              {selectedIds.size} business{" "}
              {selectedIds.size === 1 ? "type" : "types"} selected
            </strong>
            <small>Your selection travels across industries.</small>
          </div>
          <button onClick={() => setSelectionOpen(true)} type="button">
            View selection <ArrowRightGlyph />
          </button>
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        open={Boolean(detailType)}
      >
        <DialogContent
          className="c3d-dialog d4-type-dialog"
          closeButtonClassName="d4-dialog-close"
          showCloseButton
        >
          {detailType ? (
            <>
              <CoverPicture
                className="d4-detail-cover"
                id={detailType.id}
                placeholder={
                  <IndustryGlyph
                    id={category?.id ?? detailType.industries?.[0] ?? ""}
                    size={34}
                  />
                }
                size={1200}
              />
              <div className="d4-dialog-copy">
                <span className="d4-eyebrow">Business type</span>
                <DialogTitle className="d4-dialog-title">
                  {detailType.label}
                </DialogTitle>
                <DialogDescription className="d4-dialog-description">
                  {detailType.definition ?? detailType.description}
                </DialogDescription>
              </div>
              {detailType.aliases?.length ? (
                <section className="d4-dialog-section">
                  <h3>You might call it</h3>
                  <div className="d4-aliases">
                    {detailType.aliases.map((alias) => (
                      <span key={alias}>{alias}</span>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="d4-dialog-section">
                <h3>Find this type in</h3>
                <div className="d4-industry-links">
                  {(detailType.industries ?? []).map((industryId) => {
                    const industry = industryTaxonomy.find(
                      (entry) => entry.id === industryId,
                    );
                    if (!industry) return null;
                    return (
                      <button
                        key={industryId}
                        onClick={() => {
                          setDetailId(null);
                          onSelectCategory(industryId);
                        }}
                        type="button"
                      >
                        <IndustryGlyph id={industryId} size={17} />
                        {industry.label}
                        <ArrowRightGlyph />
                      </button>
                    );
                  })}
                </div>
                <p className="d4-dialog-footnote">
                  One business type can appear in several industries. Your
                  selection counts it once.
                </p>
              </section>
              <div className="d4-dialog-actions">
                <DialogClose asChild>
                  <button className="d4-secondary-button" type="button">
                    Back to browsing
                  </button>
                </DialogClose>
                <button
                  className="d4-primary-button"
                  disabled={!canFind}
                  onClick={findFromDetails}
                  type="button"
                >
                  Find prospects <ArrowRightGlyph />
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={selectionOpen} onOpenChange={setSelectionOpen}>
        <DialogContent className="c3d-dialog d4-selection-dialog">
          <div className="d4-dialog-copy">
            <span className="d4-eyebrow">Your discovery selection</span>
            <DialogTitle className="d4-dialog-title">
              {selectedTypes.length
                ? selectedTypes.length +
                  " business " +
                  (selectedTypes.length === 1 ? "type" : "types")
                : "Room for possibilities."}
            </DialogTitle>
            <DialogDescription className="d4-dialog-description">
              A single list, wherever you found each business type.
            </DialogDescription>
          </div>
          <div className="d4-selected-list">
            {selectedTypes.map((type) => (
              <div className="d4-selected-item" key={type.id}>
                <div>
                  <strong>{type.label}</strong>
                  <small>
                    {(type.industries ?? [])
                      .map(
                        (id) =>
                          industryTaxonomy.find((entry) => entry.id === id)
                            ?.label,
                      )
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <button
                  aria-label={`Remove ${type.label}`}
                  onClick={() => toggleType(type.id)}
                  type="button"
                >
                  <PlusGlyph />
                </button>
              </div>
            ))}
          </div>
          <div className="d4-dialog-actions">
            <button
              className="d4-secondary-button"
              onClick={() => setSelectedIds(new Set())}
              type="button"
            >
              Clear selection
            </button>
            <DialogClose asChild>
              <button className="d4-primary-button" type="button">
                Keep exploring <ArrowRightGlyph />
              </button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
