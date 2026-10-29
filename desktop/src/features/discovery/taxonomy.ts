import industryData from "./data/industry-taxonomy.json";
import peopleData from "./data/people-taxonomy.json";

export type TaxonomySector = { id: string; label: string };

/** One business type. `id` is the canonical id the cover-picture map uses. */
export type TaxonomyVertical = {
  id: string;
  label: string;
  /** What the screens show: the old market note where one carried over, else the definition. */
  description?: string;
  /** The v4 definition. */
  definition?: string;
  /** The South Africa market note of the old vertical this type replaces. */
  note?: string;
  /** Other names people type for this business type. */
  aliases?: string[];
  /** Every industry the type is listed in, its own first. */
  industries?: string[];
  /** The sector id the type sits in, per industry id. */
  sectors?: Record<string, string>;
  /** ISIC Rev.5 codes. */
  isic?: string[];
  /** Under an industry: the sector this type sits in there. */
  sectorId?: string;
};

export type IndustryCategory = {
  id: string;
  label: string;
  description?: string;
  sectors?: TaxonomySector[];
  verticals: TaxonomyVertical[];
};

export type PeopleField = {
  id: string;
  name: string;
  imageKey?: string;
  roles: string[];
};

export type CatalogueRow = {
  id: string;
  name: string;
  description: string;
  parentId: string;
  parentName: string;
};

/** The Discovery v4 catalogue as `build_industry_taxonomy.py` writes it. */
export type CatalogueType = TaxonomyVertical & {
  definition: string;
  industries: string[];
  sectors: Record<string, string>;
  isic: string[];
};

type CatalogueData = {
  industries: {
    id: string;
    label: string;
    description: string;
    sectors: TaxonomySector[];
  }[];
  types: CatalogueType[];
  redirects: Record<string, string>;
  /** Every id the 34 industry list used, and the type it became (if any). */
  legacy: Record<string, string | null>;
};

const catalogue = industryData as unknown as CatalogueData;
const typeIds = new Set(catalogue.types.map((type) => type.id));

function withDescription(type: CatalogueType): CatalogueType {
  return { ...type, description: type.note ?? type.definition };
}

/** Every business type once, however many industries list it. */
export const verticalTypes: CatalogueType[] =
  catalogue.types.map(withDescription);
const verticalById = new Map(verticalTypes.map((type) => [type.id, type]));

/** A type sits in every industry it lists and is shown under each one. */
export const industryTaxonomy: IndustryCategory[] = catalogue.industries.map(
  (industry) => ({
    ...industry,
    verticals: verticalTypes
      .filter((type) => type.industries.includes(industry.id))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((type) => ({ ...type, sectorId: type.sectors[industry.id] })),
  }),
);
export const peopleTaxonomy = peopleData as PeopleField[];

/** Business types, each counted once however many industries list it. */
export function countVerticals(): number {
  return catalogue.types.length;
}

/** A business type by current or saved id (see `resolveVerticalId`). */
export function findVertical(id: string): CatalogueType | undefined {
  const current = resolveVerticalId(id);
  return current ? verticalById.get(current) : undefined;
}

/**
 * The current type id for an id saved earlier (a retired canonical id, or an
 * id from the 34 industry list), or undefined when the id has no successor.
 */
export function resolveVerticalId(id: string): string | undefined {
  const seen = new Set<string>();
  let next: string | null | undefined = id;
  while (next && !seen.has(next)) {
    if (typeIds.has(next)) return next;
    seen.add(next);
    next = catalogue.redirects[next] ?? catalogue.legacy[next];
  }
  return undefined;
}

export function countPeopleRoles(): number {
  return peopleTaxonomy.reduce((count, field) => count + field.roles.length, 0);
}

/*
 * Matching. Both sides are lower-cased, "&" reads as "and", punctuation goes,
 * and each word loses a plural ending, so "Guest Houses" and "guesthouse"
 * meet. A query matches a field when its words run together appear in the
 * field ("guest house" in "guesthouses") or when every word does. Words of one
 * or two letters and "and" carry no meaning alone, so "B&B" only matches
 * through the run-together form.
 */
const IGNORED_WORDS = new Set(["and", "the", "for", "of"]);

function stemWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function normalizedWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stemWord);
}

type Field = { spaced: string; joined: string };

function field(text: string): Field {
  const words = normalizedWords(text);
  return { spaced: ` ${words.join(" ")} `, joined: words.join("") };
}

type SearchQuery = { joined: string; words: string[] };

function searchQuery(text: string): SearchQuery {
  const words = normalizedWords(text);
  return {
    joined: words.join(""),
    words: words.filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word)),
  };
}

/** Does this text hold the whole query? `fields` are the pieces it is made of. */
function holds(fields: Field[], query: SearchQuery): boolean {
  if (fields.some((entry) => entry.joined.includes(query.joined))) return true;
  if (query.words.length === 0) return false;
  return query.words.every((word) =>
    fields.some((entry) => entry.spaced.includes(word)),
  );
}

/** One business type with its text prepared once, nearest-to-the-name first. */
type SearchEntry = {
  row: CatalogueRow;
  industries: string[];
  /** Label; then plus aliases; then plus industry names; then plus the note. */
  levels: Field[][];
};

let searchIndex: SearchEntry[] | null = null;

function buildSearchIndex(): SearchEntry[] {
  const industryLabels = new Map(
    catalogue.industries.map((industry) => [industry.id, industry.label]),
  );
  return verticalTypes.map((type) => {
    const label = field(type.label);
    const aliases = (type.aliases ?? []).map(field);
    const industryNames = type.industries.map((id) =>
      field(industryLabels.get(id) ?? ""),
    );
    const note = field(`${type.definition} ${type.note ?? ""}`);
    const parentId = type.industries[0] ?? "";
    return {
      row: {
        id: type.id,
        name: type.label,
        description: type.description ?? "",
        parentId,
        parentName: industryLabels.get(parentId) ?? "",
      },
      industries: type.industries,
      levels: [
        [label],
        [label, ...aliases],
        [label, ...aliases, ...industryNames],
        [label, ...aliases, ...industryNames, note],
      ],
    };
  });
}

function rankedBusinessRows(
  query: string,
  industryId: string | null,
): CatalogueRow[] {
  searchIndex ??= buildSearchIndex();
  const wanted = searchQuery(query);
  const ranked: { tier: number; row: CatalogueRow }[] = [];
  for (const entry of searchIndex) {
    if (industryId && !entry.industries.includes(industryId)) continue;
    const tier = wanted.joined
      ? entry.levels.findIndex((fields) => holds(fields, wanted))
      : 0;
    if (tier < 0) continue;
    ranked.push({
      tier,
      row: industryId
        ? {
            ...entry.row,
            parentId: industryId,
            parentName:
              industryTaxonomy.find((industry) => industry.id === industryId)
                ?.label ?? "",
          }
        : entry.row,
    });
  }
  // Array.prototype.sort is stable: equal tiers keep catalogue order.
  return ranked.sort((a, b) => a.tier - b.tier).map((entry) => entry.row);
}

export function searchCatalogue(
  mode: "businesses" | "people",
  query: string,
  industryId: string | null,
): CatalogueRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (mode === "businesses") return rankedBusinessRows(query, industryId);

  return peopleTaxonomy.flatMap((field) => {
    if (industryId && field.id !== industryId) return [];
    return field.roles
      .map((role) => ({
        id: role
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        name: role,
        description: "",
        parentId: field.id,
        parentName: field.name,
      }))
      .filter((role) => {
        if (!normalizedQuery) return true;
        return `${role.name} ${field.name}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      });
  });
}
