import type {
  ProspectHead,
  QualifyObservationHead,
  QualifySignal,
} from "./businessRecordContract";
import {
  buildOutreachListCreateAction,
  type CreateOutreachListAction,
} from "./outreachRecords";
import type { QualifyObservationHeadView } from "./qualifyRecords";

export type QualificationNumericRange = {
  min?: number;
  max?: number;
};

export type QualificationFilter = {
  mustHave: readonly QualifySignal[];
  mustNotHave: readonly QualifySignal[];
  rating?: QualificationNumericRange;
  reviewCount?: QualificationNumericRange;
  categories?: readonly string[];
  cities?: readonly string[];
};

export type QualificationFilterLead = {
  leadId: string;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  city: string | null;
  qualification: QualifyObservationHead | null;
};

export const EMPTY_QUALIFICATION_FILTER: QualificationFilter = {
  mustHave: [],
  mustNotHave: [],
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function validRange(range: QualificationNumericRange | undefined): boolean {
  if (!range) return true;
  const { min, max } = range;
  return (
    (min === undefined || (Number.isFinite(min) && min >= 0)) &&
    (max === undefined || (Number.isFinite(max) && max >= 0)) &&
    (min === undefined || max === undefined || min <= max)
  );
}

function matchesRange(
  value: number | null,
  range: QualificationNumericRange | undefined,
): boolean {
  if (!range) return true;
  if (value === null || !validRange(range)) return false;
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

function matchesChoices(
  value: string | null,
  choices: readonly string[] | undefined,
): boolean {
  if (!choices || choices.length === 0) return true;
  if (!value) return false;
  const selected = new Set(choices.map(normalized).filter(Boolean));
  return selected.has(normalized(value));
}

function signalSelectionIsValid(filter: QualificationFilter): boolean {
  const all = [...filter.mustHave, ...filter.mustNotHave];
  return new Set(all).size === all.length;
}

/** Merge a prospect's stored Maps snapshot with its most recent qualification head. */
export function qualificationFilterLeadFromRecords(
  prospect: { record: ProspectHead },
  qualificationHeads: readonly QualifyObservationHeadView[],
): QualificationFilterLead {
  const qualification =
    qualificationHeads.find(
      (head) => head.record.leadId === prospect.record.prospectId,
    )?.record ?? null;
  const maps = prospect.record.prospect.maps ?? null;
  return {
    leadId: prospect.record.prospectId,
    rating:
      maps?.ratingHundredths === null || maps?.ratingHundredths === undefined
        ? null
        : maps.ratingHundredths / 100,
    reviewCount: maps?.reviewCount ?? null,
    category: maps?.category ?? prospect.record.prospect.vertical ?? null,
    city: maps?.city ?? prospect.record.prospect.location ?? null,
    qualification,
  };
}

/** A lead with no head, or an incomplete check, never matches a signal filter. */
export function matchesQualificationFilter(
  lead: QualificationFilterLead,
  filter: QualificationFilter,
): boolean {
  if (!signalSelectionIsValid(filter)) return false;
  if (!matchesRange(lead.rating, filter.rating)) return false;
  if (!matchesRange(lead.reviewCount, filter.reviewCount)) return false;
  if (!matchesChoices(lead.category, filter.categories)) return false;
  if (!matchesChoices(lead.city, filter.cities)) return false;
  if (filter.mustHave.length === 0 && filter.mustNotHave.length === 0) {
    return true;
  }
  const head = lead.qualification;
  if (!head) return false;
  const checked = new Set(head.checkedSignals);
  const observed = new Set(
    head.observations
      .filter((observation) => observation.state === "observed")
      .map((observation) => observation.signal),
  );
  const incomplete = new Set(
    head.observations
      .filter((observation) => observation.state === "not_checked")
      .map((observation) => observation.signal),
  );
  return (
    filter.mustHave.every((signal) => observed.has(signal)) &&
    filter.mustNotHave.every(
      (signal) =>
        checked.has(signal) && !observed.has(signal) && !incomplete.has(signal),
    )
  );
}

export function filterQualificationLeads<T extends QualificationFilterLead>(
  leads: readonly T[],
  filter: QualificationFilter,
): T[] {
  return leads.filter((lead) => matchesQualificationFilter(lead, filter));
}

/** Build a static existing-list action from the IDs matching this exact filter now. */
export function buildQualificationOutreachList(input: {
  listId: string;
  name: string;
  leads: readonly QualificationFilterLead[];
  filter: QualificationFilter;
}): CreateOutreachListAction {
  const leadIds = filterQualificationLeads(input.leads, input.filter).map(
    (lead) => lead.leadId,
  );
  return buildOutreachListCreateAction({
    listId: input.listId,
    name: input.name,
    source: { kind: "manual" },
    leadIds,
  });
}
