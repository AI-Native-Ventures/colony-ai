import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ArrowRightGlyph, IndustryGlyph } from "./DiscoveryIcons";
import { DiscoveryCoverPicture } from "./DiscoveryCoverPicture";
import {
  findVertical,
  industryTaxonomy,
  relatedVerticalsFor,
  verticalTagsFor,
  type CatalogueRow,
  type CatalogueType,
} from "./taxonomy";

export function RelatedVerticalOptions({
  types,
  onSelect,
}: {
  types: CatalogueType[];
  onSelect: (typeId: string) => void;
}) {
  if (!types.length) return null;
  return (
    <div className="d4-related-types">
      {types.map((type) => (
        <button
          aria-label={`Details for ${type.label}`}
          className="d4-related-type"
          key={type.id}
          onClick={() => onSelect(type.id)}
          type="button"
        >
          <DiscoveryCoverPicture
            className="d4-related-type-image"
            id={type.id}
            placeholder={
              <IndustryGlyph id={type.industries[0] ?? ""} size={18} />
            }
            size={640}
          />
          <span>{type.label}</span>
          <ArrowRightGlyph />
        </button>
      ))}
    </div>
  );
}

function rowForType(
  type: CatalogueType,
  industryId: string | null,
): CatalogueRow {
  const parentId =
    industryId && type.industries.includes(industryId)
      ? industryId
      : (type.industries[0] ?? "");
  return {
    id: type.id,
    name: type.label,
    description: type.definition ?? type.description ?? "",
    parentId,
    parentName:
      industryTaxonomy.find((industry) => industry.id === parentId)?.label ??
      "",
  };
}

export function DiscoveryTypeDetailsDialog({
  canFind,
  industryId,
  onClose,
  onFind,
  onSelectIndustry,
  onSelectRelated,
  showIndustries = true,
  typeId,
}: {
  canFind: boolean;
  industryId: string | null;
  onClose: () => void;
  onFind: (row: CatalogueRow, pickedTags: string[]) => void;
  onSelectIndustry: (industryId: string) => void;
  onSelectRelated: (typeId: string) => void;
  showIndustries?: boolean;
  typeId: string | null;
}) {
  const [pickedByType, setPickedByType] = React.useState<
    Record<string, string[]>
  >({});
  const [showAllByType, setShowAllByType] = React.useState<
    Record<string, boolean>
  >({});

  const type = typeId ? findVertical(typeId) : undefined;
  const tags = type ? verticalTagsFor(type.id) : [];
  const pickedTags = type ? (pickedByType[type.id] ?? []) : [];
  const showAll = type ? (showAllByType[type.id] ?? false) : false;
  const related = type ? relatedVerticalsFor(type.id) : [];
  const visibleTags = showAll ? tags : tags.slice(0, 12);

  function toggleTag(tag: string) {
    if (!type) return;
    setPickedByType((previous) => {
      const current = previous[type.id] ?? [];
      const next = current.includes(tag)
        ? current.filter((entry) => entry !== tag)
        : current.length < 3
          ? [...current, tag]
          : current;
      return { ...previous, [type.id]: next };
    });
  }

  function findFromDetails() {
    if (!type) return;
    onFind(rowForType(type, industryId), pickedTags);
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={Boolean(type)}
    >
      <DialogContent
        className="c3d-dialog d4-type-dialog"
        closeButtonClassName="d4-dialog-close"
        data-testid="discovery-type-details-dialog"
        showCloseButton
      >
        {type ? (
          <>
            <DiscoveryCoverPicture
              className="d4-detail-cover"
              id={type.id}
              placeholder={
                <IndustryGlyph
                  id={industryId ?? type.industries[0] ?? ""}
                  size={34}
                />
              }
              size={1200}
            />
            <div className="d4-dialog-copy">
              <span className="d4-eyebrow">Business type</span>
              <DialogTitle className="d4-dialog-title">
                {type.label}
              </DialogTitle>
              <DialogDescription className="d4-dialog-description">
                {type.definition ?? type.description}
              </DialogDescription>
            </div>
            {type.aliases?.length ? (
              <section className="d4-dialog-section">
                <h3>You might call it</h3>
                <div className="d4-aliases">
                  {type.aliases.map((alias) => (
                    <span key={alias}>{alias}</span>
                  ))}
                </div>
              </section>
            ) : null}
            {tags.length ? (
              <section
                className="d4-dialog-section"
                data-testid="discovery-tag-picker"
              >
                <div className="d4-tag-picker-heading">
                  <div>
                    <h3>Narrow the search</h3>
                    <p>
                      Pick up to 3 tags. The result page is split across them.
                    </p>
                  </div>
                  <span aria-live="polite">{pickedTags.length} of 3</span>
                </div>
                <fieldset
                  aria-label="Search refinement tags"
                  className="d4-tag-options"
                >
                  {visibleTags.map(({ tag, kind }) => {
                    const selected = pickedTags.includes(tag);
                    return (
                      <button
                        aria-pressed={selected}
                        className={selected ? "is-picked" : ""}
                        data-testid={`discovery-tag-${tag}`}
                        disabled={!selected && pickedTags.length >= 3}
                        key={`${kind}:${tag}`}
                        onClick={() => toggleTag(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    );
                  })}
                </fieldset>
                {tags.length > 12 ? (
                  <button
                    className="d4-tag-show-all"
                    onClick={() => {
                      if (type) {
                        setShowAllByType((previous) => ({
                          ...previous,
                          [type.id]: !showAll,
                        }));
                      }
                    }}
                    type="button"
                  >
                    {showAll ? "Show fewer" : `Show all ${tags.length} tags`}
                  </button>
                ) : null}
              </section>
            ) : null}
            {showIndustries ? (
              <section className="d4-dialog-section">
                <h3>Find this type in</h3>
                <div className="d4-industry-links">
                  {type.industries.map((industryId) => {
                    const industry = industryTaxonomy.find(
                      (entry) => entry.id === industryId,
                    );
                    if (!industry) return null;
                    return (
                      <button
                        key={industryId}
                        onClick={() => onSelectIndustry(industryId)}
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
            ) : null}
            {related.length ? (
              <section
                className="d4-dialog-section"
                data-testid="discovery-related-types"
              >
                <h3>Also try</h3>
                <RelatedVerticalOptions
                  onSelect={onSelectRelated}
                  types={related}
                />
              </section>
            ) : null}
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
  );
}
